/* ================= 番茄钟 ================= */
BF.focus = (function () {
  let _state = 'idle', _left = 25 * 60, _total = 25 * 60, _timer = null, _autoNoiseId = null, _deadline = 0;
  let _noiseLastSig = '';   /* 白噪音联动的状态签名缓存 */
  let _stale = false;       /* 恢复时发现过期存档，延迟提示用 */
  /* —— 会话存档 ——
     番茄钟只存在内存里时，刷新就归零、联动开的白噪音静默停，所以把 deadline
     落到 sessionStorage（会话存储）：关标签页即清，不会跨会话复活昨天没关完的
     番茄钟（localStorage 有这个副作用）；刷新/崩溃后按存档恢复。
     键名集中本常量一处；不进 BF.store.K——那张表管 localStorage 持久层。 */
  const SS_KEY = 'bf_focus_session';
  function _save() {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({
        s: _state, total: _total, dl: _deadline, run: _timer ? 1 : 0,
        left: _timer ? Math.max(0, Math.ceil((_deadline - Date.now()) / 1000)) : _left,
      }));
    } catch (e) { BF.log && BF.log.warn('store.番茄钟断点写入失败，本轮计时将无法跨页恢复：' + (e && e.message)); }
  }
  function _clear() { try { sessionStorage.removeItem(SS_KEY); } catch (e) { BF.log && BF.log.warn('storage.会话清理失败：' + (e && e.message)); } }
  /* 今日轮数唯一来源 = FOCUS_CYCLES 日账（本地日期键），
     读失败按 0 处理，不阻断计时。 */
  function _cyclesToday() {
    try {
      const _cm = BF.store.lsGet(BF.store.K.FOCUS_CYCLES, {}) || {};
      const _dk = (BF.stats && BF.stats.todayKey) ? BF.stats.todayKey() : (function () { const _d = new Date(); return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()); })();
      return _cm[_dk] || 0;
    } catch (e) { return 0; }
  }
  /* 收束提示音。专注/休息结束是定时器回调（无用户手势），
     AudioContext 可能被浏览器策略暂停——resume 失败就静默放弃（绝不谎报）。
     音效跟随「桌面通知」开关：desktopNoti 明确设为关闭视为不想被打扰。 */
  let _audioCtx = null;
  function _chimeWarm() {
    try {
      if (!_audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) _audioCtx = new AC(); }
      if (_audioCtx && _audioCtx.state === 'suspended' && _audioCtx.resume) _audioCtx.resume().catch(function () {});
    } catch (e) {}
  }
  function _chime() {
    try {
      if (BF.settings.get('desktopNoti') === false) return;
      _chimeWarm();
      if (!_audioCtx || _audioCtx.state !== 'running') return;
      const t0 = _audioCtx.currentTime;
      [[880, t0], [660, t0 + 0.18]].forEach(function (p) {
        const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = p[0];
        g.gain.setValueAtTime(0.0001, p[1]);
        g.gain.exponentialRampToValueAtTime(0.12, p[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, p[1] + 0.16);
        o.connect(g); g.connect(_audioCtx.destination);
        o.start(p[1]); o.stop(p[1] + 0.2);
      });
    } catch (e) {}
  }
  const listeners = [];
  function _mode(sec) {
    /* 状态判定按段长——短休/长休（<25 分钟档）都是休息，
       用 `sec <= 5*60` 这类时长阈值会把「长休 15」误标成专注中。 */
    _total = sec; _left = sec; _state = sec < 25 * 60 ? 'break' : 'working';
    _chimeWarm();   /* 用户手势路径：预热提示音通道 */
    _start();
  }
  function _start() {
    if (_timer) _timer();
    /* 时间戳计时：剩余秒数由截止时间戳推导，不每秒自减。
       后台标签页/系统休眠时 setInterval 会被浏览器节流甚至挂起，
       「_left--」自减写法休眠 10 分钟只计 3 分钟、醒来后基数已错；
       必须用 _deadline = Date.now() + _left*1000，每次 tick 按真实
       经过时间重算 _left，暂停时把 _left 写定为当前真实剩余。 */
    _deadline = Date.now() + _left * 1000;
    /* 存档必须落在 _timer 赋值之后：_save 用 _timer 是否存在推导 run 标记，
       写在前面就是「运行中的会话永远存成 run:0」，刷新回来被当成暂停态还原，
       倒计时停住且剩余秒数退回起始值 —— 正是要修的「刷新归零」的另一半。 */
    _timer = BF.timers.interval(_tick, 1000);
    _save();   /* 开始/续跑即落会话存档 */
  }
  /* 每秒回调与重载恢复共用同一份 tick，避免两处手抄漂移 */
  function _tick() {
    _left = Math.max(0, Math.ceil((_deadline - Date.now()) / 1000));
    if (Date.now() >= _deadline) {
      _left = 0;
      _timer(); _timer = null;
      _onExpire();
      _render();
      return;
    }
    _render();
  }
  function _onExpire() {
    /* 专注结束自动进入休息段，休息结束才回 idle：
       番茄钟惯例是专注→休息自动衔接，不该要用户手动再点「休息」。 */
    if (_state === 'working') {
      /* 轮次记账先做——休息时长依完成轮数而定。
         写独立日账 FOCUS_CYCLES（日键与 focus_daily 同源 todayKey），
         供面板「今日完成 N 轮」与长休判定读取；写失败不阻断衔接。 */
      try {
        const _ck = BF.store.K.FOCUS_CYCLES;
        const _dk2 = (BF.stats && BF.stats.todayKey) ? BF.stats.todayKey() : (function () { const _d = new Date(); return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()); })();
        const _cm = BF.store.lsGet(_ck, {}) || {};
        _cm[_dk2] = (_cm[_dk2] || 0) + 1;
        BF.store.lsSet(_ck, _cm);
      } catch (e) { BF.err.report('focus.cycles', e); }
      const _n = _cyclesToday();
      const _brk = (_n > 0 && _n % 4 === 0) ? 15 * 60 : 5 * 60;
      /* 专注时长写独立的 focus 键，不经 BF.stats.add 计 daily：
         阅读计时器对同一段时间也在累加 daily，专注期间同时开着阅读页
         每一秒被计两次，每日目标虚假达成。独立键仍参与「今日投入」汇总，
         不污染阅读时长统计。 */
      try {
        const _focusMin = Math.round(_total / 60);
        /* 键经 K 表真源（BF.store.K.FOCUS_DAILY），
           不散写字面键名 'focus_daily' */
        const _fk = BF.store.K.FOCUS_DAILY;
        const _fd = BF.store.lsGet(_fk, {}) || {};
        /* 日切键必须用 BF.stats.todayKey()（本地日期键），与两处读取
           （目标统计 _focusTodayMin、统计栏「今日专注」块）同源对齐：
           若用 new Date().toISOString() 的 UTC 键，GMT+8 凌晨
           00:00–07:59 结束的专注会写「昨日」键——今日专注块显示
           0 且误显「开始一次番茄钟后统计」，目标纳入专注开启时
           该时段不计入当日目标（本周合计不受影响，仍按 7 天窗累计）。
           历史 UTC 键数据由 7 天窗自然消化（不迁移、不回填）。
           fallback 分支同样用本地时区派生键，与主分支的
           BF.stats.todayKey() 同源——否则 fallback 又退回 UTC 键，
           会重复 GMT+8 凌晨写「昨日」键这同一个缺陷。 */
        const _dk = (BF.stats && BF.stats.todayKey) ? BF.stats.todayKey() : (function () { const _d = new Date(); return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()); })();
        _fd[_dk] = (_fd[_dk] || 0) + _total;
        /* 落盘必须检查 lsSet 返回值（false = 存储异常，如配额
           耗尽），不能写入静默失败而专注结束 toast 仍报成功，
           失败时降级提示。 */
        const _saved = BF.store.lsSet(_fk, _fd);
        const _today = (BF.stats && BF.stats.todayDisplay) ? BF.stats.todayDisplay() : 0;
        if (_saved === false) {
          BF.noti.warn('专注结束，本次 ' + _focusMin + ' 分钟（记录未能保存：本地存储空间不足，该时长不计入统计），自动进入休息（' + Math.round(_brk / 60) + ' 分钟）');
        } else {
          BF.noti.success('专注结束，本次 ' + _focusMin + ' 分钟（今日阅读约 ' + _today + ' 分钟），自动进入休息（' + Math.round(_brk / 60) + ' 分钟）');
        }
      } catch (e) { BF.err.report('focus.stats', e); BF.noti.success('专注结束，自动进入休息（' + Math.round(_brk / 60) + ' 分钟）'); }
      _state = 'break'; _total = _brk; _left = _brk;
      _chime();   /* 后台标签收不到 toast，但听得到提示音 */
      _start();
      _render();
      return;
    }
    /* 休息结束：回待命并重置显示（与「跳过休息」一致，面板不残留 00:00） */
    _chime();
    BF.noti.success('休息结束');
    _state = 'idle';
    _left = 25 * 60; _total = 25 * 60;
    _clear();   /* 会话自然收束，清存档 */
  }
  /* 面板内的计时文字 + 顶栏常驻指示共用同一份渲染：
     _render 若只更新面板里的节点，面板一关计时虽还在跑
     却完全不可见，用户以为它停了。 */
  /* 顶栏有 3 个（首页/书架/阅读器），每个都注入了一份 chip。
     必须用 querySelectorAll 遍历而不是 getElementById ——
     三份 chip 内部用的是同一组 id（HTML 规范禁止重复 id，但这里靠
     querySelectorAll 绕开），getElementById 只认第一个，
     结果就是「只有首页的 chip 在走时间，切到书架就变成死的时间」。 */
  function _renderChip() {
    const boxes = document.querySelectorAll('[data-focus-chip]');
    if (!boxes.length) return;
    const m = Math.floor(_left / 60), s = _left % 60;
    const txt = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    const pct = Math.max(0, Math.min(100, _left / (_total || 1) * 100)) + '%';
    boxes.forEach(function (box) {
      box.hidden = _state === 'idle';
      /* 用 classList 切换 is-break，不要整段重写 className（避免误抹其他类，也避开 ' active' 拼串） */
      box.classList.toggle('is-break', _state === 'break');
      const t = box.querySelector('.focus-chip__time');
      if (t) t.textContent = txt;
      const lb = box.querySelector('.focus-chip__label');
      if (lb) lb.textContent = _state === 'working' ? '专注中' : '休息中';
      const bar = box.querySelector('.focus-chip__bar');
      if (bar) bar.style.width = pct;
    });
  }
  function _fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  /* 专注自动白噪音联动 —— 开始专注且开启开关时自动播放，休息/结束时停止 */
  function _applyAutoNoise() {
    if (!BF.noise) return;
    const want = _state === 'working' && !!BF.settings.get('focusAutoNoise');
    if (want && !_autoNoiseId) { try { BF.noise.play('rain'); _autoNoiseId = 'rain'; } catch (e) {} }
    else if (!want && _autoNoiseId) { try { BF.noise.stop(_autoNoiseId); } catch (e) {} _autoNoiseId = null; }
  }
  function _render() {
    const t = document.getElementById('focus-time');
    const label = document.getElementById('focus-label');
    const txt = _fmt(_left);
    if (t) t.textContent = txt;
    if (label) label.textContent = _state === 'working' ? '专注中' : _state === 'break' ? '休息中' : '专注';
    const toggle = document.getElementById('focus-toggle');
    /* 休息进行中按钮改「跳过休息」——休息是一段可以放弃的
       缓冲，语义上不存在「暂停休息」；休息被暂停过（_timer 空）仍回「继续」。 */
    if (toggle) toggle.textContent = _state === 'idle' ? '开始' : (_state === 'break' && _timer ? '跳过休息' : (_timer ? '暂停' : '继续'));
    _renderChip();
    /* 自动白噪音只在「状态变化点」消费（working↔break↔idle、
       计时启停），不随 _render 每秒读设置/碰播放器。用签名比对实现
       等价语义：即使某处赋值点缺状态标记，也不会每秒白读一遍设置。 */
    const _noiseSig = _state + ':' + (_timer ? 1 : 0);
    if (_noiseSig !== _noiseLastSig) { _noiseLastSig = _noiseSig; try { _applyAutoNoise(); } catch (e) {} }
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function toggle() {
    if (_state === 'idle') { _mode(25 * 60); return; }
    /* 休息进行中点按钮 = 跳过休息，收束回待命（不自动开新专注）。
       跳过也要清会话存档，否则重载后会把已放弃的休息恢复出来。 */
    if (_state === 'break' && _timer) {
      _timer(); _timer = null; _state = 'idle'; _left = 25 * 60; _total = 25 * 60;
      _clear();
      _render();
      return;
    }
    if (_timer) { _left = Math.max(0, Math.ceil((_deadline - Date.now()) / 1000)); _timer(); _timer = null; _save(); }
    else _start();
    _render();
  }
  function reset() { if (_timer) _timer(); _timer = null; _state = 'idle'; _left = 25 * 60; _total = 25 * 60; _clear(); _render(); }
  function mode(sec) { _mode(sec); _render(); }
  /* —— 重载恢复 ——
     刷新/崩溃后从会话存档还原：运行中按 deadline 语义续跑（刷新期间
     流逝的时间照算——deadline 是绝对时间戳，语义一致）；暂停态还原
     剩余秒数等用户点继续；已过期清档重置并延迟提示（IIFE 执行时
     noti 多半未就绪，等 1.5s 再说话——不静默吞掉「你的专注丢了」）。 */
  (function _recover() {
    let raw = null;
    try { raw = sessionStorage.getItem(SS_KEY); } catch (e) { return; }
    if (!raw) return;
    let s = null;
    try { s = JSON.parse(raw); } catch (e) { _clear(); return; }
    if (!s || (s.s !== 'working' && s.s !== 'break')) { _clear(); return; }
    _state = s.s; _total = s.total || 25 * 60;
    _left = s.run ? Math.max(0, Math.ceil(((s.dl || 0) - Date.now()) / 1000)) : (Number(s.left) || 0);
    if (_left <= 0) {
      _clear(); _stale = true;
      _state = 'idle'; _left = 25 * 60; _total = 25 * 60;
      return;
    }
    if (s.run) {
      _deadline = Date.now() + _left * 1000;
      _timer = BF.timers.interval(_tick, 1000);
    }
    _render();
  })();
  if (_stale) {
    BF.timers.timeout(function () {
      try { if (BF.noti && BF.noti.info) BF.noti.info('上一次专注会话已超时结束，番茄钟已重置'); } catch (e) {}
    }, 1500);
  }
  return {
    toggle, reset, mode, _render,
    /* state 必须回 left/total/running，只回 'idle'/'working'/'break'
       字符串拿不到剩余时间，顶栏指示无从渲染。state 字段名保持不变，
       外部读 state.state 仍是原语义（DSL 里若有引用不会崩）。 */
    state: function () {
      return { state: _state, left: _left, total: _total, running: !!_timer };
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    isRunning: function () { return _state !== 'idle'; },
    autoNoiseId: function () { return _autoNoiseId; },
    _cyclesToday,   /* 工作台专注栏「今日完成 N 轮」读取（日账真源） */
  };
})();

