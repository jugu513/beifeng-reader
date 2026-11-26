/* ================= L12b. 跨书正文搜索 =================
   书架页「搜正文」入口。遍历所有书，每本书按现有 searchAll 的逻辑（Worker 优先，
   主线程兜底）检索正文，结果按书分组。复用 BF.reader.searchAll 的批次并发与进度文案。 */
BF.library.acrossPanel = null;

