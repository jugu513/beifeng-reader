/* ================= 18. 阅读器路由（转发到 BF.reader 域） ================= */
BF.app.openBook = function (id) { return BF.reader.openBook(id); };
BF.app.closeReader = function () { return BF.reader.closeReader(); };
BF.app.prevChapter = function () { return BF.reader.prevChapter(); };
BF.app.nextChapter = function () { return BF.reader.nextChapter(); };
BF.app.gotoChapter = function (idx) {
  /* 新增：切章时停自动滚动（否则 rAF 推着新章内容跑，位置漂移） */
  try { BF.enh && BF.enh.autoScroll && BF.enh.autoScroll.isOn() && BF.enh.autoScroll.stop(); } catch (e) {}
  return BF.reader.gotoChapter(idx);
};
/* 转发器族，供插件与 DSL 通过 BF.app.* 这一层稳定入口操作阅读器。
   applyReaderStyles 已登记进 DSL 白名单与命令表，
   「改完样式立即重绘」这一散落多处的能力由此有了统一入口。 */
BF.app.applyReaderStyles = function () { BF.reader.applyStyles(); };

/* ============================================================
   北风 · library 域：导入 / 编码探测 / 分章 / LZ / 下载
   ============================================================ */
BF.library = BF.library || {};

