/* ================= 11b. BF.prefs 随书偏好 =================
   来源：Yomikiru preset（global + perBook 双层）。
   北风落地：字号随书记忆。global 仍由 settings 管；perBook 覆盖层存
   perbook_prefs = { [bookId]: { fontSize } }。reader 应用字号时优先 perBook，
   用户调字号（命令/设置面板）时同步写当前书的 perBook 覆盖。
   其余偏好仍全局（不做过度分层）。 */
BF.prefs = (function () {
  const K = 'perbook_prefs';
  /* 内存镜像 + 尾部合并落盘：阅读器里连按十次字号 = 十次全量重写整张表
     + 十条通知。整表只有几 KB 但写次数与按键次数同量，且每次通知都往 noti_history 落一条。
     规则：内存同步更新（读侧永远读到最新值，`get` 不等落盘），落盘合并成一次尾部写；
     页面隐藏 / 卸载前强制 flush，防抖窗口内关页面不丢最后一次。
     写侧只有本模块两处（set / purgeBook），镜像不会与旁路写入打架。 */
  let _m = null, _timer = null;
  function _all() {
    if (_m) return _m;
    let v;
    try { v = BF.store.lsGet(K, {}); } catch (e) { v = {}; }
    _m = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    return _m;
  }
  function _write() {
    const all = _all();
    if (_timer) { try { _timer(); } catch (e) {} _timer = null; }
    BF.store.setCritical(K, all, '随书偏好');
  }
  function _schedule(now) {
    if (now) { _write(); return; }
    if (_timer) return;
    _timer = BF.timers.timeout(function () { _timer = null; _write(); }, 600);
  }
  /* 读某书覆盖值（无覆盖返回 null → 调用方回退 global） */
  function get(bookId, key) {
    if (!bookId) return null;
    const m = _all()[bookId];
    return (m && m[key] !== undefined) ? m[key] : null;
  }
  /* 写某书覆盖值（设为 null 删除该键）。
     提示只在「这本书的记忆项数发生变化」时给一次：
     每写一个值都弹一条「已记忆 N 项」，连按字号十下就堆十条通知；
     项数没变就说明只是改值，用户已经知道自己在调字号，不需要再告知一次。
     同时给「恢复跟随全局」动作——覆盖值存在时本书不再吃全局滑块，
     这一点必须当场可见、当场可退，而不是让人去设置面板里找。 */
  function set(bookId, key, val) {
    if (!bookId) return;
    const all = _all();
    const m = all[bookId] = all[bookId] || {};
    const before = Object.keys(m).length;
    if (val == null) { delete m[key]; if (!Object.keys(m).length) delete all[bookId]; }
    else m[key] = val;
    _schedule();
    try {
      const n = Object.keys(all[bookId] || {}).length;
      if (n > 0 && n !== before && BF.noti) {
        const meta = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
        const b = meta.find(function (x) { return x && x.id === bookId; });
        BF.noti.info('已记忆《' + ((b && b.title) || '本书') + '》的 ' + n + ' 项偏好。这几项只跟这本书走，设置面板的同名滑块不再影响它。',
          { action: { label: '恢复跟随全局', run: function () { try { BF.prefs.purgeBook(bookId); } catch (e) { BF.err.report('prefs.undo', e); } } } });
      }
    } catch (e) {}
  }
  /* 合并读取：perBook 优先，无覆盖回退 global（由调用方提供 global 值）。
     随书偏好另有一条存储路径，脏值夹取必须在这一条也生效：字号 999 存在书级键里与
     存在全局键里弄坏界面的方式一模一样。 */
  function resolve(bookId, key, globalVal) {
    const v = get(bookId, key);
    return BF.settings.clampRange(key, v != null ? v : globalVal);
  }
  /* 某书记忆项数（设置面板「随书偏好」
     入口行显示——数据层确认值） */
  function count(bookId) {
    const m = _all()[bookId];
    return m ? Object.keys(m).length : 0;
  }
  /* 清除某书全部记忆项（设置面板
     「清除当前书」入口）；返回是否确有清除。
     删书级联（BF.app._doDelete）同调此法清孤儿——
     否则删书不清 perbook_prefs，书删后条目残留，
     用得越久垃圾越多。 */
  function purgeBook(bookId) {
    if (!bookId) return false;
    const all = _all();
    if (!all[bookId]) return false;
    delete all[bookId];
    /* 删书 / 恢复跟随全局 都是「一次性语义动作」，立即落盘，不进防抖窗口 */
    _schedule(true);
    return true;
  }
  /* 防抖窗口内页面要被关掉/切后台时把最后一次写落地；
     备份导出这类「按 LS 真值读」的调用方也可以直接调 flush。 */
  try {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') _schedule(true); });
    window.addEventListener('pagehide', function () { _schedule(true); });
  } catch (e) { BF.err.report('prefs.flushHook', e); }
  return { get: get, set: set, resolve: resolve, count: count, purgeBook: purgeBook, flush: function () { _schedule(true); } };
})();

