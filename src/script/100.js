/* ================= T11. 保活 ================= */
BF.tts.wakeLock = async function () {
  const st = BF.tts.state;
  try {
    if (!('wakeLock' in navigator) || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    /* 并发请求要在 await 之前占位：连点两次会同时通过上面的判断、各拿一条锁，
       后一条覆盖 _wakeLock，先拿的那条再没人释放，屏幕就一直不灭。 */
    if (st._wakeLock || st._wakePending) return;
    st._wakePending = true;
    let _lk = null;
    try { _lk = await navigator.wakeLock.request('screen'); } finally { st._wakePending = false; }
    st._wakeLock = _lk;
    _lk.addEventListener('release', function () {
      st._wakeLock = null;
      if (st.playing && document.visibilityState === 'visible') BF.tts.wakeLock();
    });
  } catch (e) {
    st._wakePending = false;
    /* 拿不到锁是常态（页面不可见、无用户激活、后发请求顶掉先发），屏幕锁只是最佳努力：
       不锁屏不影响朗读，被拒不该刷错误日志。其它异常仍上报，但只报一次。 */
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return;
    if (st._wakeErrSeen) return;
    st._wakeErrSeen = true;
    BF.err.report('wakeLock', e);
  }
};
BF.tts.wakeLockRelease = function () {
  try { if (BF.tts.state._wakeLock) { BF.tts.state._wakeLock.release(); BF.tts.state._wakeLock = null; } } catch (e) {}
};
/* 锁屏/系统媒体中心的当前曲目信息。
   只在 start() 里写一次的话，自动翻章后锁屏上还是上一章的标题——
   章标题就绪的每个点都要重刷，所以抽成一处、多处调用。 */
BF.tts.setMediaMeta = function () {
  if (!('mediaSession' in navigator) || !navigator.mediaSession || typeof MediaMetadata !== 'function') return;
  const b = BF.reader.state.book;
  const idx = BF.appState.currentChapterIdx;
  const t = BF.reader.state.title || BF.tts.state.chapterTitle || (idx != null ? '第' + (idx + 1) + '章' : '');
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t,
    artist: (b && b.title) || '未命名书籍',
    album: '北风',
  });
};
BF.tts.mediaSessionInit = function () {
  try {
    if (!('mediaSession' in navigator) || !navigator.mediaSession || BF.tts.state._mediaSessionReady) return;
    if (typeof navigator.mediaSession.setActionHandler !== 'function') return;
    navigator.mediaSession.setActionHandler('play', function () { if (!BF.tts.state.playing) BF.tts.toggle(); });
    navigator.mediaSession.setActionHandler('pause', function () { BF.tts.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', function () { BF.tts.prevChapter(); });
    navigator.mediaSession.setActionHandler('nexttrack', function () { BF.tts.nextChapter(); });
    BF.tts.state._mediaSessionReady = true;
  } catch (e) { BF.err.report('mediaSession', e); }
};
/* 停止时把系统媒体中心也交还：只撤播放不撤 handler，锁屏上会一直挂着
   上一章的书名与一颗按了没反应的播放键。下一次 start 会重新初始化。 */
BF.tts.mediaSessionTeardown = function () {
  try {
    if (!('mediaSession' in navigator) || !navigator.mediaSession) return;
    if (typeof navigator.mediaSession.setActionHandler === 'function') {
      ['play', 'pause', 'previoustrack', 'nexttrack'].forEach(function (a) { try { navigator.mediaSession.setActionHandler(a, null); } catch (e) {} });
    }
    try { navigator.mediaSession.metadata = null; } catch (e) {}
    try { navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    BF.tts.state._mediaSessionReady = false;
  } catch (e) {}
};

/* ============================================================
   北风 · tts 域（三）：设置联动 / 试听 / 选区朗读 / 初始化
   ============================================================ */

