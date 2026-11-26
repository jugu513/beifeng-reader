/* ================= T1. 状态 ================= */
BF.tts.state = {
  playing: false, timer: 0, startTime: 0,
  wordsRead: 0, pos: 0, bookId: null, chapterIdx: 0, _wakeLock: null, _wakeErrSeen: false,
  _errCount: 0, _autoNext: false, _autoNextT: null, _retried: false,
  /* 真暂停用的两个字段：当前在播的音源 + AudioContext 是否被暂停冻住。
     只在 pause/resume/stop 三处写，别的路径不碰。 */
  _src: null, _ctxPaused: false,
  _mediaSessionReady: false, engine: 'offline', segs: [],
  /* 停止意图标志 + 离线空转检测。
     无语音时 utterance 立刻 onend，会被当成「读完」推进下一段并重启，朗读停不下来；
     stop() 只置 playing=false，没有任何机制阻止后续自动重启。
     故 _stopIntent 是「用户已停止」的硬标志，所有可能重启播放的回调入口先查它；
     _idleStart 记录离线引擎每次 speak 的时间戳，用于空转检测（连续 3 段 <150ms 判定）。 */
  _stopIntent: false, _idleStart: null,
  /* 自动续播令牌：segEnd 等翻章期间持有，任何非自动切章或用户停止都会清掉它。
     只靠 _stopIntent 分不清「用户按了停止」和「自动切章自己发的 stop」——
     gotoChapter 切章前必停朗读，那一停会把自动续播自己也拦住。 */
  _autoTok: null,
  /* 显式状态机：idle→loading→playing→paused，失败进 error，停止回 idle。
     playing 布尔仍是既有调用面的真值（不另起炉灶）；phase 把这五个阶段说破，
     转场单一写点 _setPhase，读侧（诊断 / 联动 / 运维台）按 phase 判，
     不再各自从布尔与引擎字段拼状态。 */
  phase: 'idle',
};
BF.tts._setPhase = function (p) {
  if (BF.tts.state.phase === p) return;
  BF.tts.state.phase = p;
  try { if (BF.bus) BF.bus.emit(BF.EVENTS.TTS, { phase: p }); } catch (e) {}
};

