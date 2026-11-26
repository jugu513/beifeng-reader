/* ================= C11 余量项：标注 Obsidian 回链导出 =================
   标注导出为 Obsidian 可回链格式：Markdown 链接
   [[书名#第N章]] + 块引用（> 原文随行）。
   口径说明：北风 loc 是章内段偏移，Obsidian 块 ID
   体系无对应物——回链粒度到章级，原文以块引用
   随行（不伪造块 ID）。当前书标注四类全量导出。 */
BF.ai.obsidianExport = async function () {
  const bid = BF.appState.currentBookId;
  const book = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (b) { return b && b.id === bid; });
  if (!book) { BF.noti.warn('请先打开一本书'); return; }
  const hls = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || [];
  const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []) || [];
  const vocs = BF.store.lsGetArray(BF.store.K.VOCAB, []) || [];
  const notes = BF.store.lsGetArray(BF.store.K.NOTES, []) || [];
  const mine = {
    hl: hls.filter(function (x) { return x && x.bookId === bid; }),
    bm: bms.filter(function (x) { return x && x.bookId === bid; }),
    voc: vocs.filter(function (x) { return x && x.bookId === bid; }),
    note: notes.filter(function (x) { return x && x.bookId === bid; }),
  };
  const total = mine.hl.length + mine.bm.length + mine.voc.length + mine.note.length;
  if (!total) { BF.noti.info('本书还没有标注可导出'); return; }
  const title = book.title || '未知书籍';
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
  /* 块引用内换行缩进保持引用块结构；长文截断
     防单条膨胀（原文引用语义完整优先保前段）。
     Obsidian 默认渲染行内 HTML —— 正文里一句 `<img src=x onerror=…>` 会在收件人的
     笔记里执行，等于把「读一本TXT」变成「在别人电脑上跑代码」。导出前按实体写出去，
     预览看到的仍是原字符。 */
  const mtxt = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  const quote = function (s, cap) {
    return mtxt(s).replace(/\r\n|\r|\n/g, '\n  > ').slice(0, cap || 400);
  };
  const L = ['# 标注回链 · 《' + mtxt(title) + '》', '',
    '> 导出 ' + total + ' 条标注 · ' + new Date().toLocaleString('zh-CN') + '（回链粒度：章级 + 原文块引用）',
    '> ⚠️ 单向导出：本文件由北风导出，仅供在 Obsidian 中查看与引用；Obsidian 内的任何编辑不会回写北风，重新导出会覆盖本地改动。', ''];
  /* 缺 chapterIdx 条目（无位置便签——
     W3C 导入 ingest 不落 chapterIdx）标注
     「（未定位）」并省略章级回链：不能回落成
     [[书名#第1章]]，否则出处标注与实际不符 */
  const emit = function (type, ch, text, extra) {
    if (typeof ch === 'number') {
      L.push('- 第' + (ch + 1) + '章 · ' + type + ' [[' + title + '#第' + (ch + 1) + '章]]');
    } else {
      L.push('- （未定位） · ' + type);
    }
    if (text) L.push('  > ' + quote(text));
    if (extra) L.push('  > ' + quote(extra, 200));
    L.push('');
  };
  mine.hl.forEach(function (h) { emit('划线', h.chapterIdx, h.text, h.note); });
  mine.bm.forEach(function (m) { emit('书签', m.chapterIdx, m.text, ''); });
  mine.voc.forEach(function (v) { emit('生词', v.chapterIdx, v.word, v.ctx ? '语境：' + v.ctx : ''); });
  mine.note.forEach(function (n) { emit('便签', n.chapterIdx, n.title ? n.title + '：' + n.text : n.text, ''); });
  const _ok = await BF.exportBlob(safe + '_标注回链.md', L.join('\n'), { mime: 'text/markdown;charset=utf-8' });
  /* 按 exportBlob 返回值门控；成功文案取数据层确认值 */
  if (_ok) BF.noti.success('已导出 ' + total + ' 条标注回链（Obsidian Markdown）');
};

