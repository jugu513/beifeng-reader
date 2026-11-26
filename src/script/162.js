/* ================= 委托绑定（新增功能入口） ================= */
(function () {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (t.closest('[data-chapter-shot]')) { BF.enh.chapterScreenshot(); return; }
    if (t.closest('[data-export-selfpkg]')) { BF.selfPackage.export(); return; }
    if (t.closest('[data-export-ask]')) {
      const fmt = t.closest('[data-export-ask]').getAttribute('data-export-ask') || 'md';
      BF.ai.exportAskHistory(null, fmt === 'json' ? 'json' : 'md');
      const m = document.getElementById('reader-more-menu'); if (m) m.style.display = 'none';
      return;
    }
    if (t.closest('[data-export-notes]')) { BF.enh.exportNotes(t.closest('[data-export-notes]').dataset.exportNotes || 'md'); return; }
    /* 标注 W3C 导入（JSON-LD；回执明列配不上的标注） */
    if (t.closest('[data-ann-import]')) { BF.ann.importAnnotations(); return; }
    if (t.closest('#tts-status-label2')) { if (BF.tts.state.bookId) BF.app.openBook(BF.tts.state.bookId); return; }
    if (t.closest('[data-export-all-zip]')) { BF.enh.exportAllBooks(true); return; }
    if (t.closest('[data-export-all]')) { BF.enh.exportAllBooks(false); return; }
    if (t.closest('[data-autoscroll]')) {
      const on = BF.enh.autoScroll.toggle();
      BF.noti.info(on ? '自动滚动开启（空格停止）' : '自动滚动已停止');
      return;
    }
    if (t.closest('[data-opfs-snap]')) { BF.enh.opfs.snapshot().then(r => BF.noti.success(r.ok ? 'OPFS 快照已保存' : 'OPFS 不可用：' + (r.reason || ''))); return; }
    if (t.closest('[data-opfs-restore]')) { BF.enh.opfs.restore().then(r => r && r.reason === '已取消' ? BF.noti.info('已取消恢复') : BF.noti.success(r.ok ? 'OPFS 快照已恢复' : 'OPFS 恢复失败：' + ((r && r.reason) || ''))); return; }
    /* 阅读器更多菜单 */
    if (t.closest('[data-reader-more]')) { BF.enh.readerMoreMenu(); return; }
  });
})();

