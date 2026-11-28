/* L18. HTML 导入 —— 单文件网页 / 电子书 XHTML 转正文。
   链路：解码（编码交给 BF.library.decodeBuffer 自动判）→ 摘 <head>/<nav>/注释
   → 找 h1–h3：够两处就按它切章（标题那行留在章首，阅读器会去重），
     不够就整篇剥标签交 BF.smart.chapters 按章标记分。
   取舍：不保排版不保图片——<head> 里的样式与脚本整段丢弃，正文是纯文本，
   与 TXT 同一条渲染路径，划线 / 朗读 / 搜索零适配。 */
BF.html = {
  sniff: function (buf, name) {
    if (/\.x?html?$/i.test(String(name || ''))) return true;
    /* 无扩展名的在线内容才看内容：zip 一律让给容器格式，别把 epub 认成网页 */
    if (!buf || buf.length < 16) return false;
    if (buf[0] === 0x50 && buf[1] === 0x4b) return false;
    let head = '';
    for (let i = 0; i < Math.min(512, buf.length); i++) head += String.fromCharCode(buf[i]);
    head = head.toLowerCase();
    return head.indexOf('<!doctype html') >= 0 || head.indexOf('<html') >= 0;
  },

  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    const html0 = BF.library.decodeBuffer(bytes, 'auto').text;
    if (!html0 || !html0.trim()) throw new Error('没有可读正文');
    let title = '';
    const tm = html0.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) title = BF.epub._clean(tm[1]);
    /* 头部与导航是页面骨架不是正文：<title> 已取走，其余整段丢；
       注释交给 _html2Text 处理，这里只摘结构性的两块。 */
    const html = html0
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ');

    const heads = [];
    const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = re.exec(html))) heads.push({ at: m.index, txt: BF.epub._clean(m[2]) });
    if (heads.length >= 2) {
      const chapters = [];
      for (let i = 0; i < heads.length; i++) {
        const slice = html.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : html.length);
        const body = BF.epub._html2Text(slice);
        if (!body) continue;
        chapters.push({ title: heads[i].txt || ('第 ' + (chapters.length + 1) + ' 章'), content: body });
      }
      if (chapters.length) return { title: title, chapters: chapters };
    }
    return { title: title, text: BF.epub._html2Text(html) };
  },
};
/* HTML 段结束 */
