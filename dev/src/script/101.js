/* ================= T12. 设置联动 ================= */
BF.tts.setRate = function (v) {
  BF.settings.set('ttsRate', parseFloat(v) || 1);
  const el = document.getElementById('tts-speed');
  if (el) el.textContent = v + 'x';
  const _c = BF.tts.cap(BF.tts.state.engine);
  if (BF.tts.state.playing && _c && _c.native) {
    /* 语速对浏览器代管播放的档是 utterance 上的参数：不重说这一句就听着没变。
       联网档的语速烧在下一次合成请求里，当前句不动，所以这里不管它。 */
    _c.stopNative();
    if (BF.tts.state.segs) _c.playNative(BF.tts.state.segs, BF.tts.state.pos);
  }
};
BF.tts.cycleTimer = function () {
  /* 步进统一走 BF.CONFIG.TTS_SLEEP_STEPS，且必须写进 settings.ttsSleepMin——
     只写 BF.tts.state.timer 时，朗读启动读的是 settings，两套状态不联通，
     点顶栏「关→15分」对睡眠定时就毫无作用。
     定时器本身复用 start() 的 _sleepT 一条通道：原来这里另起一个 interval，
     既和 start 已排的 _sleepT 重复计时（先到的那个提前停，另一个到点再弹一次
     「已停止」），又会在用户手动停止后继续跑到期限，凭空弹一条停止提示。
     这里只重排，不新造第二套计时。 */
  const opts = BF.CONFIG.TTS_SLEEP_STEPS;
  const cur = BF.settings.num('ttsSleepMin', 0);
  const i = opts.indexOf(cur);
  const next = opts[(i < 0 ? 0 : i + 1) % opts.length];
  BF.settings.set('ttsSleepMin', next);
  BF.tts.state.timer = next;
  const el = document.getElementById('tts-timer');
  if (el) {
    el.textContent = next ? next + '分' : '关';
    el.classList.toggle('off', !next);
  }
  BF.tts._clearSleep();
  if (next > 0 && BF.tts.state.playing) {
    BF.tts._sleepT = BF.timers.timeout(function () { BF.noti.info('睡眠定时已到，停止朗读'); BF.tts.stop(); }, next * 60000);
  }
};
BF.tts.tryVoice = function () {
  /* 设置面板「试听」按当前音色试一句。联网档与 BF.tts.preview 是同一条路径
     （合成一句 → 解码 → 出声 → 把结果落探针态），原来这里按引擎名抄了三遍，
     每遍各写一次探针与文案：再加一档引擎要改两处，且这两处会先漂移再报错。 */
  const eng = BF.tts.pickEngine();
  const cap = BF.tts.cap(eng);
  if (cap && cap.native) {
    BF.tts.offline.tryVoice();
    BF.tts.stab.noteProbe(eng, 'ok');
    return;
  }
  BF.tts.preview();
};

