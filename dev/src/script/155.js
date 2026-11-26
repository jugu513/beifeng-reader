/* ================= 书籍信息弹窗（可编辑元数据） ================= */
BF.enh.showBookInfo = function (id) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === id);
  if (!b) return;
  const tagStr = (b.tags || []).join(' ');
  const save = function () {
    const t = document.getElementById('bi-title');
    const a = document.getElementById('bi-author');
    const g = document.getElementById('bi-tags');
    /* R1：表单值在回调外读成局部量，回调内重新 find 改字段。 */
    const _title = (t && t.value.trim()) ? t.value.trim() : null;
    const _author = a ? a.value.trim() : null;
    const _tags = g ? g.value.trim().split(/\s+/).filter(Boolean) : null;
    BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      arr = arr || [];
      const _b = arr.find(function (x) { return x && x.id === id; });
      if (!_b) return false;
      if (_title) _b.title = _title;
      if (_author !== null) _b.author = _author;
      if (_tags) _b.tags = _tags;
      return arr;
    }).then(function (ok) {
      if (ok === false) { BF.log && BF.log.warn('书籍信息写入失败，书可能已被删除'); return; }
      BF.app.renderBookshelf(); BF.app.renderHome();
      BF.noti.success('书籍信息已更新');
    });
  };
  BF.modal.custom('书籍信息 · 可编辑',
    '<div style="line-height:2.0;font-size:13px;color:var(--text-dim)">' +
    '<div>章节：' + (b.totalChapters || 0) + ' 章 · 大小：' + (b.size ? BF.util.fmtBytes(b.size) : '—') + ' · 字数：' + (b.statsUnknown ? '未知' : BF.util.fmtNum(b.wordCount || 0)) + '</div>' +
    '<div>进度：' + ((b.currentChapter || 0) + 1) + '/' + (b.totalChapters || 1) + ' 章 · 收藏：' + (b.starred ? '★' : '—') + (b.pinned ? ' · 置顶' : '') + '</div>' +
    '<div>导入：' + (b.importedAt ? new Date(b.importedAt).toLocaleString('zh-CN') : '—') + ' · 最近读：' + (b.lastRead ? new Date(b.lastRead).toLocaleString('zh-CN') : '—') + '</div>' +
    '<div>便签：' + (function () { try { return (BF.store.lsGetArray(BF.store.K.NOTES, []) || []).filter(n => n && n.bookId === id).length; } catch (e) { return 0; } })() + ' 条（AI 研读中心可查看）</div>' +
    '<div style="margin-top:10px">书名：<input class="input" id="bi-title" style="width:100%;margin-top:4px" value="' + BF.dom.escAttr(b.title || '') + '"/></div>' +
    '<div style="margin-top:6px">作者：<input class="input" id="bi-author" style="width:100%;margin-top:4px" value="' + BF.dom.escAttr(b.author || '') + '" placeholder="作者（可选）"/></div>' +
    '<div style="margin-top:6px">标签：<input class="input" id="bi-tags" style="width:100%;margin-top:4px" value="' + BF.dom.escAttr(tagStr) + '" placeholder="多个标签用空格分隔"/></div>' +
    '</div>' +
    '<div class="dlg-foot">' +
    '<button class="btn btn-sm" data-modal-cancel>取消</button>' +
    '<button class="btn btn-sm primary" data-modal-ok>保存</button>' +
    '</div>',
    function (box, dismiss) {
      box.querySelector('[data-modal-cancel]').onclick = function () { dismiss(); BF.modal.hide(); };
      box.querySelector('[data-modal-ok]').onclick = function () { dismiss(); save(); BF.modal.hide(); };
    });
};

