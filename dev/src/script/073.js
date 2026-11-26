/* ================= R8. 章节预取 =================
   预取须存正文本身并做 LRU 缓存（上限 9 章），供 getChapterText 命中——
   只存布尔 true 而丢弃正文的话，真正读章时仍要重走 IDB + gzip 解压，
   预取成了纯负收益；不设上限则缓存跨书无限增长（内存泄漏）。 */
BF.reader.__prefetched = {};
BF.reader.__prefetchOrder = [];
BF.reader.__prefetching = {};   /* 在途去重：同一章正在读时再请求也只读一次 */
let _pfGen = 0;                 /* clearPrefetch 递增；在途结果回来时世代不符就丢弃 */
/* 访问序刷新：写入与命中共用同一份实现。两处各写一遍是 LRU 退化成 FIFO 的常见来路
   （只改写入那处、忘了命中那处）。 */
BF.reader.__prefetchTouch = function (key) {
  const _i = BF.reader.__prefetchOrder.indexOf(key);
  if (_i >= 0) BF.reader.__prefetchOrder.splice(_i, 1);
  BF.reader.__prefetchOrder.push(key);
};
/* 正文进 LRU 的唯一写点（预取与开章共用，同一套上限与去重）。
   空串不入表：一次读失败若被存进缓存，getChapterText 之后每次都命中这份空正文，
   「这一章空白」就从瞬时故障变成持久故障。先摘旧位再入队尾，否则淘汰会连着有效项一起删。 */
BF.reader.__prefetchPut = function (key, text) {
  if (!text) return;
  BF.reader.__prefetchTouch(key);
  BF.reader.__prefetched[key] = text;
  while (BF.reader.__prefetchOrder.length > 9) {
    const old = BF.reader.__prefetchOrder.shift();
    delete BF.reader.__prefetched[old];
  }
};
BF.reader.prefetch = function (idx) {
  const b = BF.reader.state.book;
  if (!b || !BF.settings.get('chapterPrefetch')) return;
  if (idx < 0 || idx >= (b.totalChapters || 0)) return;
  const key = b.id + '_' + idx;
  if (BF.reader.__prefetched[key] != null || BF.reader.__prefetching[key]) return;
  const _gen = _pfGen;
  BF.reader.__prefetching[key] = true;
  BF.library.getChapterText(b, idx).then(function (text) {
    /* 期间清过缓存（换书 / 删除 / 重分章）：这份结果已经没有去处 ——
       照写进去就是「清过了还留着上一本的正文」，缓存上限也会被它占掉一格。 */
    if (_gen !== _pfGen) return;
    BF.reader.__prefetchPut(key, text);
  }).catch(function (e) { BF.err.report('prefetch', e); }).then(function () { delete BF.reader.__prefetching[key]; });
};
/* 换书 / 删除书时清空预取缓存，避免正文常驻内存 */
BF.reader.clearPrefetch = function () {
  _pfGen++;
  BF.reader.__prefetched = {};
  BF.reader.__prefetchOrder = [];
  BF.reader.__prefetching = {};
};

