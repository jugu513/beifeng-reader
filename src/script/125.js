/* ================= 白噪音 ================= */
BF.noise = (function () {
  /* 外链音源（actions.google.com/sounds）有 403 失效风险，默认走本地合成
     （AudioContext 生成白/粉/棕噪音，零网络依赖），
     外链保留为可选「高质量音源」开关（设置 noiseUseRemote），失败自动降级本地。
     API：toggle / stopAll / setVolume / active / stop。
     起播/停止/调音量全部 GainNode 线性渐变（淡入 0.35s / 淡出 0.25s /
     微调 0.08s）——阶跃赋值会产生可闻爆音与滑块拉链噪声。 */
  const SOUNDS = [
    { id: 'rain', label: '雨声', url: 'https://actions.google.com/sounds/v1/weather/rain_on_roof.ogg', local: 'pink' },
    { id: 'waves', label: '海浪', url: 'https://actions.google.com/sounds/v1/water/waves_crashing_on_rocks.ogg', local: 'brown' },
    { id: 'wind', label: '风声', url: 'https://actions.google.com/sounds/v1/ambiences/wind_through_leaves.ogg', local: 'pink' },
    { id: 'birds', label: '鸟鸣', url: 'https://actions.google.com/sounds/v1/animals/birds_chirping.ogg', local: 'white' },
    { id: 'cafe', label: '咖啡馆', url: 'https://actions.google.com/sounds/v1/ambiences/cafe_ambience.ogg', local: 'brown' },
    { id: 'fire', label: '篝火', url: 'https://actions.google.com/sounds/v1/ambiences/outdoor_night.ogg', local: 'brown' },
  ];
  let _ctx = null, _playing = new Map(), _vol = 0.5;
  /* 音量渐变常量（秒）。起播/停止/调音量直接跳变 GainNode 值会产生
     可闻爆音（值阶跃即「啪」一声），滑块连续拖动时的阶跃还会叠加拉链噪声。
     起播淡入、停止淡出、调音量短渐变，全部走 linearRampToValueAtTime。 */
  const FADE_IN = 0.35, FADE_OUT = 0.25, FADE_NUDGE = 0.08;
  /* 从当前值线性渐变到 to：先取消挂起的旧事件、把当前值钉成新起点再排目标，
     连续调节（滑块拖动）不会互相打架。gain 不可用时静默跳过（调用方兜底）。 */
  function _ramp(gain, to, secs) {
    if (!gain || !gain.gain) return;
    try {
      const now = _ctx ? _ctx.currentTime : 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(to, now + secs);
    } catch (e) {}
  }
  function _ensureCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') { try { _ctx.resume(); } catch (e) {} }
    return _ctx;
  }
  /* 本地合成噪音：白噪音（均匀随机）→ 粉噪音（一阶低通滤波，更柔和）→ 棕噪音（更强低通，更低沉）。
     生成 3 秒 buffer 循环播放，零网络、零体积。 */
  function _synth(kind) {
    const ctx = _ensureCtx();
    const dur = 3, sr = ctx.sampleRate, len = Math.floor(dur * sr);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      let v = w;
      if (kind === 'pink') {
        /* 粉噪音：Paul Kellet 一阶滤波近似 */
        b0 = 0.997 * b0 + 0.997 * w * 0.025;
        b1 = 0.985 * b1 + 0.985 * w * 0.1;
        v = (b0 + b1 + w) / 3;
      } else if (kind === 'brown') {
        /* 棕噪音：积分 + 归一化（防漂移） */
        last = (last + 0.02 * w) / 1.02;
        v = last * 3.5;
      }
      data[i] = v;
    }
    return buf;
  }
  /* 本地播放入口：id 对应的本地合成 buffer 循环播放 */
  function _playLocal(id, s) {
    const ctx = _ensureCtx();
    const gain = ctx.createGain();
    gain.gain.value = 0;                 /* 从 0 起，淡入到当前音量，杜绝起播爆音 */
    const src = ctx.createBufferSource();
    src.buffer = _synth(s.local || 'white');
    src.loop = true;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    _ramp(gain, _vol, FADE_IN);
    _playing.set(id, { src, gain, local: true });
    BF.noti.info('白噪音 · ' + s.label + '（本地合成）');
  }
  function play(id) {
    const ctx = _ensureCtx();
    const s = SOUNDS.find(x => x.id === id);
    if (!s || _playing.has(id)) return;
    /* 默认走本地合成（零网络依赖）。仅当用户显式开启 noiseUseRemote 才尝试外链。 */
    const useRemote = BF.settings.get('noiseUseRemote') === true;
    if (!useRemote) { _playLocal(id, s); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      BF.noti.info('白噪音 · ' + s.label + '（离线，本地合成）');
      _playLocal(id, s);
      return;
    }
    /* 占位对象同时当「本轮加载」的凭据：加载期间用户 stop / 再次 toggle 会替换或删除
       _playing[id]，异步回调必须只认自己这一轮，否则「关掉了却又响起来」、
       或两轮失败各自降级本地合成导致叠加播放。 */
    const ticket = { pending: true };
    _playing.set(id, ticket);
    const gain = ctx.createGain();
    gain.gain.value = 0;                   /* 等音频真正解码到达再淡入，加载期间保持静音 */
    /* 外链档在本机 6/6 全部超时（actions.google.com 不可达），
       而原来的 fetch 不带超时：点一下就是一段没有任何反馈的静音。
       现在 8s 硬顶 + 先说「正在载入在线音源」，失败把降级这件事讲出来。 */
    const nCtrl = new AbortController();
    const nTimer = BF.timers.timeout(function () { try { nCtrl.abort(); } catch (e) {} }, 8000);
    BF.noti.info('白噪音 · ' + s.label + '（正在载入在线音源）');
    fetch(s.url, { signal: nCtrl.signal }).then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then(function (audioBuf) {
      nTimer();
      const p = _playing.get(id);
      if (p !== ticket) return;             /* 这一轮已被 stop / 重新 toggle 取代，丢弃当次播放 */
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.loop = true;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      _ramp(gain, _vol, FADE_IN);          /* 在线音源同样淡入（目标取当前音量） */
      _playing.set(id, { src, gain, local: false });
      BF.noti.info('白噪音 · ' + s.label + '（在线音源）');
    }).catch(function (e) {
      /* 外链失败：降级到本地合成，并把「降级了、为什么」说出来 */
      nTimer();
      /* 用户已经停掉或重新开始这一档时，这轮失败不该再翻动 _playing：
         否则「关掉的又响起来」，或两轮都失败时各自降级本地、叠成两份声音。 */
      if (_playing.get(id) !== ticket) return;
      _playing.delete(id);
      BF.err.report('noise:' + id + ':remote', e);
      BF.log.warn('白噪音外链失败，已降级本地合成：' + s.id);
      BF.noti.warn('在线音源载入失败（超时或不可达），已改用本地合成');
      _playLocal(id, s);
    });
  }
  /* 淡出后延迟真正停止。直接 src.stop() 会把声音一刀切断（爆音）；
     淡出期间音源仍在播但已从 _playing 摘除——toggle 快速关开时旧音源自然
     淡出、新音源淡入，不叠加不卡顿。延迟停止走 BF.timers（定时器治理，
     不造裸 setTimeout）。 */
  function _fadeOutAndStop(p) {
    if (!p) return;
    if (p.gain && p.src) {
      _ramp(p.gain, 0.0001, FADE_OUT);
      const src = p.src, gain = p.gain;
      BF.timers.timeout(function () {
        try { src.stop(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      }, Math.round(FADE_OUT * 1000) + 60);
    } else {
      /* pending 占位（外链加载中）：没有可停的音源，fetch 回来时按 _playing 缺失丢弃 */
      try { if (p.src) p.src.stop(); } catch (e) {}
      try { if (p.gain) p.gain.disconnect(); } catch (e) {}
    }
  }
  function stop(id) {
    const p = _playing.get(id);
    if (!p) return;
    _playing.delete(id);
    _fadeOutAndStop(p);
  }
  function toggle(id) {
    if (_playing.has(id)) stop(id); else play(id);
    return _playing.has(id);
  }
  function setVolume(v) {
    _vol = v;
    /* 音源异步加载期间 _playing 里是 pending 占位（无 gain），操作前必须判 p.gain，
       否则 TypeError 会中断整个 forEach，导致其他音源也调不了音量。
       调音量走短渐变（80ms），滑块连续拖动不产生拉链噪声；
       渐变从当前值接续，中途改方向不跳。 */
    _playing.forEach(function (p) { if (p && p.gain) _ramp(p.gain, v, FADE_NUDGE); });
  }
  function stopAll() {
    const ps = [..._playing.entries()];
    _playing.clear();
    if (!ps.length) { if (_ctx) { try { _ctx.suspend(); } catch (e) {} } return; }
    /* 先淡出再挂起——直接 suspend() 会把播放中的声音一刀切断（爆音），
       且淡出期间用户若重新播放，挂起必须让位（_playing 非空则不挂起）。 */
    ps.forEach(function (e) { _fadeOutAndStop(e[1]); });
    BF.timers.timeout(function () {
      if (_playing.size) return;
      if (_ctx) { try { _ctx.suspend(); } catch (e) {} }
    }, Math.round(FADE_OUT * 1000) + 80);
  }
  function active() { return [..._playing.keys()]; }
  /* play 必须在导出列表里：专注自动白噪音联动
     （BF.focus._applyAutoNoise 调 BF.noise.play('rain')）——
     play 缺失时调用即抛 TypeError，被 catch (e) {}
     静默吞掉，用户只看到「专注中」却永远听不到声音。 */
  return { SOUNDS, play, toggle, stopAll, setVolume, active, stop };
})();

