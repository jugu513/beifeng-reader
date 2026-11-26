/* ================= 笔记导出 CSV / MD ================= */
BF.enh.exportNotes = function (fmt) {
  fmt = fmt || 'md';
  /* W3C JSON-LD 标注导出走 BF.ann 统一实现
     （四类标注 + 三层锚点 + charOffset/color/status）；
     md/csv 由本函数渲染。 */
  if (fmt === 'w3c') { BF.ann.exportAnnotations(); return; }
  const b = BF.reader.state.book;
  if (!b) { BF.noti.warn('请先打开一本书'); return; }
  const hls = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []).filter(x => x.bookId === b.id);
  const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []).filter(x => x.bookId === b.id);
  const notes = BF.store.lsGetArray(BF.store.K.NOTES, []).filter(x => x.bookId === b.id);
  const title = b.title;
  let out = '';
  if (fmt === 'csv') {
    /* 字段级转义（RFC 4180）：划线/备注文本含逗号/双引号/换行时
       用双引号包裹并倍增双引号，字段内换行才不会截断 CSV 记录
       （只转义双引号挡不住换行破行）。 */
    const _f = BF.exportBlob.csvField;
    out = '类型,章节,内容,备注\n';
    hls.forEach(h => { out += [_f('划线'), _f('第' + ((h.chapterIdx || 0) + 1) + '章'), _f(h.text || ''), _f(h.note || '')].join(',') + '\n'; });
    bms.forEach(m => { out += [_f('书签'), _f('第' + ((m.chapterIdx || 0) + 1) + '章'), _f(m.text || '位置书签'), _f('')].join(',') + '\n'; });
    notes.forEach(n => { out += [_f('笔记'), _f(''), _f(n.text || ''), _f('')].join(',') + '\n'; });
  } else {
    out = '# ' + title + ' 笔记\n\n';
    out += '## 划线\n\n';
    hls.forEach(h => { out += '- 第' + ((h.chapterIdx || 0) + 1) + '章：' + (h.text || '') + (h.note ? '（' + h.note + '）' : '') + '\n'; });
    out += '\n## 书签\n\n';
    bms.forEach(m => { out += '- 第' + ((m.chapterIdx || 0) + 1) + '章：' + (m.text || '位置书签') + '\n'; });
    out += '\n## 便签\n\n';
    notes.forEach(n => { out += '- ' + (n.text || '') + '\n'; });
  }
  /* 按 exportBlob 返回值门控（同步站点走
     .then，对齐阅读笔记导出的门控模式；取消
     保存选择器不弹成功） */
  BF.exportBlob(title + '_笔记.' + fmt, out, { mime: fmt === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8', csv: fmt === 'csv' })
    .then(function (ok) { if (ok) BF.noti.success('笔记已导出（' + fmt.toUpperCase() + '）'); });
};

