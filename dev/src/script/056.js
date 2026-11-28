/* ================= L9. 拖拽导入（只有样式无事件，北风补真实现） ================= */
(function () {
  let _dragDepth = 0;
  document.addEventListener('dragenter', function (e) {
    e.preventDefault();
    _dragDepth++;
    const card = document.querySelector('.add-card');
    if (card) card.classList.add('dragover');
  });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('dragleave', function (e) {
    e.preventDefault();
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (_dragDepth === 0) {
      const card = document.querySelector('.add-card');
      if (card) card.classList.remove('dragover');
    }
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    _dragDepth = 0;
    const card = document.querySelector('.add-card');
    if (card) card.classList.remove('dragover');
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /\.(?:txt|text|json|epub|pdf|mobi|azw|azw3|docx?|html?|xhtml|fb2|md|markdown|cbz)$/i.test(f.name));
    if (files.length) BF.library.importFiles(files);
    else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) BF.noti.warn('仅支持 TXT / EPUB / PDF / MOBI / DOCX / HTML / FB2 / Markdown / CBZ 文件');
  });
})();

