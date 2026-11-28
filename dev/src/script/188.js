/* L20. Markdown 导入 —— 网上流传的 .md 电子书、笔记导出。
   链路：解码 → 剥 YAML 头 → 按 1–2 级 ATX 标题切章（围栏代码里的 # 不算），
     标题行的 # 在正文里一并去掉（阅读器按「首行 = 章题」去重，留着 # 会显示两遍）
     → 每章过一遍 _md2Text 去记号；一个标题都没有就整篇清洗后交 BF.smart.chapters。
   取舍：只留可读文字——链接留文字不留地址、图片留替代文字、表格留单元格丢竖线；
   围栏代码保留内容（它是正文的一部分），围栏行本身去掉。 */
BF.markdown = {
  sniff: function (buf, name) { return /\.(?:md|markdown|mdown|mkd|mkdn)$/i.test(String(name || '')); },

  /* 正文记号清洗：只做「看得见的符号」这一层，不动中英文标点 */
  _md2Text: function (s) {
    let t = String(s).replace(/\r\n?/g, '\n');
    /* 围栏代码先整块摘走暂存：里面的 # / * / 列表符都是代码的一部分，
       混进下面的记号清洗会被当成 Markdown 删掉（Python、shell 的注释首当其冲）。
       摘完剩一个占位行，清洗结束再原样放回。 */
    const stash = [];
    t = t.replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm, function (all, fence, body) {
      stash.push(body);
      return '\n\u0000bfcode' + (stash.length - 1) + '\u0000\n';
    });
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');              /* 图片 → 替代文字 */
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');               /* 链接 → 文字 */
    t = t.replace(/`([^`\n]+)`/g, '$1');                         /* 行内代码 */
    t = t.replace(/<\/?(?:br|p|div|span|em|strong|b|i|u|s|strike|code|pre|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|td|th|a|img)\b[^>]*>/gi, function (all) {
      return /^<br/i.test(all) ? '\n' : '';
    });
    t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');              /* 标题记号 */
    t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '');                   /* 引用 */
    t = t.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '');               /* 无序列表 */
    t = t.replace(/^[ \t]{0,3}\d{1,3}[.)][ \t]+/gm, '');         /* 有序列表 */
    t = t.replace(/^\|[\s:\-|]+\|[ \t]*$/gm, '');                /* 表格分隔行 */
    t = t.replace(/^\|.*\|[ \t]*$/gm, function (row) {
      return row.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }).filter(Boolean).join(' ');
    });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');                   /* 粗体 */
    t = t.replace(/__([^_\n]+)__/g, '$1');
    t = t.replace(/\*([^*\n]+)\*/g, '$1');                       /* 斜体 */
    t = t.replace(/~~([^~\n]+)~~/g, '$1');                       /* 删除线 */
    t = t.replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, '');  /* 分隔线 */
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    /* 代码块放回：占位行自己已被压成一个空行，直接换回原文即可 */
    return t.replace(/\u0000bfcode(\d+)\u0000/g, function (all, i) { return stash[Number(i)] || ''; }).trim();
  },

  /* 切章：1–2 级 ATX 标题为界；围栏内的 # 不算；标题行本身留在章首（去 # 后与章题同形） */
  _split: function (s) {
    const lines = String(s).replace(/\r\n?/g, '\n').split('\n');
    const segs = [];
    let cur = { title: '', lines: [] };
    let fence = '';
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const fm = L.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fm) {
        if (!fence) fence = fm[1][0];
        else if (fence === fm[1][0]) fence = '';
        cur.lines.push(L);
        continue;
      }
      if (fence) { cur.lines.push(L); continue; }
      const hm = L.match(/^[ \t]{0,3}(#{1,2})[ \t]+(\S.*)$/);
      if (hm && hm[2].trim()) {
        if (cur.title || cur.lines.join('').trim()) segs.push(cur);
        cur = { title: hm[2].trim(), lines: [L] };
      } else cur.lines.push(L);
    }
    if (cur.title || cur.lines.join('').trim()) segs.push(cur);
    const out = [];
    const self = this;
    segs.forEach(function (seg) {
      const body = self._md2Text(seg.lines.join('\n'));
      if (!body) return;
      out.push({ title: (seg.title || '正文').slice(0, 60), content: body });
    });
    return out;
  },

  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    const dec = BF.library.decodeBuffer(bytes, 'auto');
    let s = dec.text || '';
    if (!s.trim()) throw new Error('没有可读正文');
    /* YAML 头：--- 开头到下一个 --- 整块丢，里面的 title 顺手当书名 */
    let bookTitle = '';
    const fm = s.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n/);
    if (fm) {
      const yt = fm[1].match(/^title\s*:\s*(.+)$/m);
      if (yt) bookTitle = yt[1].trim().replace(/^["']|["']$/g, '');
      s = s.slice(fm[0].length);
    }
    const h1 = s.match(/^#[ \t]+(\S.*)$/m);
    let title = (bookTitle || (h1 ? h1[1].trim() : '')).replace(/\s+/g, ' ');
    let chapters = this._split(s);
    /* 首章只剩一行标题（Markdown 的「# 书名」）：它是书名不是章节。
       留着会在目录里挂一个点开即空的假章，阅读器会把它当空章跳过。 */
    if (chapters.length > 1 && chapters[0].title &&
      chapters[0].content.replace(/\s+/g, '') === chapters[0].title.replace(/\s+/g, '')) {
      if (!title) title = chapters[0].title;
      chapters = chapters.slice(1);
    }
    /* 一个真标题都没切出来（只剩 _split 的「正文」兜底段）：这份 MD 靠的不是
       ATX 标题，而是「第X章」这类行内章标记 —— 交统一分章器去认，
       别自己硬切成一整章（那样划线/朗读全书只有一个坐标系）。 */
    if (chapters.length && !(chapters.length === 1 && chapters[0].title === '正文')) {
      return { title: title, chapters: chapters };
    }
    return { title: title, text: this._md2Text(s) };
  },
};
/* Markdown 段结束 */
