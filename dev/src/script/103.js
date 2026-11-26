/* ================= T14. 初始化 ================= */
BF.tts.init = function () {
  if (!BF.tts.offline.available()) {
    /* 只经 lampRefresh 写灯 */
    if (BF.tts.stab && BF.tts.stab.lampRefresh) BF.tts.stab.lampRefresh();
    else {
      const label = document.getElementById('tts-status-label');
      if (label) label.textContent = 'TTS 不可用';
    }
    BF.ui.setStatusDot('warn');
    return;
  }
  BF.tts.offline.loadVoices();
  /* 坏引擎 / 无语音时 onvoiceschanged 可能永远不触发，语音表长期空着：
     2s 兜底再探一次，仍空就按无语音如实处理（不卡启动、不阻塞朗读降级）。 */
  if (!BF.tts.offline.voices || !BF.tts.offline.voices().length) {
    BF.timers.timeout(function () { try { BF.tts.offline.loadVoices(); } catch (e) {} }, 2000);
  }
  try { BF.tts.health.init(); } catch (e) { BF.err.report('tts.health.init', e); }
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = function () {
      BF.tts.offline.loadVoices();
      /* 设置面板正开着：语音表在面板打开之后才到齐时，把「离线语音」那一行重建出来 */
      try {
        if (BF.settingsUI && BF.settingsUI._dirty && BF.sheet && BF.sheet.isOpen && BF.sheet.isOpen('settings')) {
          BF.settingsUI._dirty.tts = true;
          if (BF.settingsUI.rerender) BF.settingsUI.rerender();
        }
      } catch (e) {}
    };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && BF.tts.state.playing) {
      const _vc = BF.tts.cap(BF.tts.state.engine);
      if (_vc && _vc.native) _vc.resumeNative();
      else if (BF.tts._audioCtx && BF.tts._audioCtx.state === 'suspended') { try { BF.tts._audioCtx.resume(); } catch (e) {} }
    }
  });
  BF.log.info('tts ready');
};
BF.tts.updateTimerUI = function () {
  /* 必须回读 settings.ttsSleepMin：硬编码「关」会把用户在设置面板/顶栏选的值在 TTS 就绪时抹掉 */
  const el = document.getElementById('tts-timer');
  if (!el) return;
  const v = BF.settings.num('ttsSleepMin', 0);
  el.textContent = v ? v + '分' : '关';
  el.classList.toggle('off', !v);
};

