/* ================= 环境背景动画=================
   纯 CSS 实现（body::after 上的渐变 + transform/opacity 动画），不占主线程。
   两档：none / mist。
   降级链：设置为 none、系统 reduce、设置「减少动效」开、FPS 连续偏低 → 全部退化为静态。 */
BF.amb = (function () {
  /* 氛围只保留 ['none','mist']：极光/余烬两类装饰性动画不做
     （渐变滥用/霓虹/装饰动画均属禁区；薄雾是唯一保留的氛围层）。 */
  const KINDS = ['none', 'mist'];
  const LABEL = { none: '关闭', mist: '薄雾' };
  let _degraded = false;   /* 因低帧率自动降级（用户可再手动改回来） */
  let _lowStreak = 0;
  let _recoverStreak = 0;  /* 降级后帧率恢复健康线的连续采样计数 */

  function kind() { const k = BF.settings.get('bgAnim'); return KINDS.indexOf(k) >= 0 ? k : 'none'; }
  /* 只回布尔不够：blocked 若只返回布尔，「选了薄雾却没动」有四种完全不同的原因，
     用户和 UI 都无从分辨——最常见的是系统开了减少动效、或分页模式在用，
     这两种都不是设置里的 bgAnim 能解决的。blockReason 返回原因字符串供 UI 展示，
     布尔语义由 blocked 保留（内部与外部都还在用）。 */
  function blockReason() {
    if (kind() === 'none') return '';
    if (BF.settings.get('reduceMotion')) return '已在设置中开启「减少动效」';
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return '系统偏好要求减少动效'; } catch (e) {}
    if (_degraded) return '帧率偏低，已自动降级';
    /* 分页模式开着时不做背景动画：翻页本身要重排，再叠动画容易掉帧 */
    try { if (BF.reader && BF.reader.pageModeActive && BF.reader.pageModeActive()) return '分页模式下暂停（翻页需重排）'; } catch (e) {}
    return '';
  }
  function blocked() { return !!blockReason(); }
  function apply() {
    const b = document.body;
    /* 全部档位清掉再按需加：'none' 也必须在清理列表里。
       清理列表漏任何一档，'none' 档走 blocked 返回 false 之外的路径
       时会挂上一个 CSS 里根本不存在的 anim-none——无害但脏，且会让
       「当前有没有开动画」的 class 判断永远为真（调试与自动化都靠这个）。 */
    KINDS.forEach(function (k) { b.classList.remove('anim-' + k); });
    if (kind() === 'none' || blocked()) return;
    b.classList.add('anim-' + kind());
  }
  function set(k) {
    if (KINDS.indexOf(k) < 0) return;
    _degraded = false;   /* 手动选择视为用户主动覆盖，解除低帧降级 */
    BF.settings.set('bgAnim', k);
    apply();
    if (k !== 'none') BF.noti && BF.noti.success('背景氛围：' + (LABEL[k] || k));
  }
  function cycle() {
    const i = KINDS.indexOf(kind());
    set(KINDS[(i + 1) % KINDS.length]);
  }
  /* 低帧自动降级：连续 3 次采样（每秒一次，间隔 BF.CONFIG.AMB_FPS_LOW 秒）低于阈值就关掉。
     降级后帧率回到健康线（>= 阈值）连续 3 次采样即自动复原，解除 _degraded，
     让用户的原始选择重新生效——只降不升的话，背景动画一旦降级就永久关掉。
     （「三档：关闭 / 仅氛围 / 跟随帧率」中，none=关闭、mist=仅氛围、本自动降级+复原=跟随帧率。） */
  function tick() {
    if (kind() === 'none') { _lowStreak = 0; _recoverStreak = 0; return; }
    const fps = (BF.perf && BF.perf.snapshot) ? (BF.perf.snapshot().fps || 0) : 0;
    if (_degraded) {
      /* 已降级：等帧率恢复健康再复原，避免在临界点反复开关 */
      if (fps === 0 || fps >= BF.CONFIG.AMB_FPS_LOW) {
        _recoverStreak++;
        if (_recoverStreak >= 3) {
          _degraded = false; _recoverStreak = 0;
          apply();
          BF.log && BF.log.info('背景动画已恢复（帧率回到 ' + fps + 'fps）');
        }
      } else _recoverStreak = 0;
      return;
    }
    if (fps > 0 && fps < BF.CONFIG.AMB_FPS_LOW) {
      _lowStreak++;
      if (_lowStreak >= 3) {
        _degraded = true; _lowStreak = 0;
        apply();
        BF.log && BF.log.warn('背景动画已自动关闭（连续低帧率 ' + fps + 'fps）');
        BF.noti && BF.noti.warn('检测到帧率偏低，已自动关闭背景动画（可在设置里重新开启）');
      }
    } else _lowStreak = 0;
  }
  function startAuto() {
    if (BF.timers && BF.timers.interval) BF.timers.interval(tick, BF.CONFIG.AMB_CHECK_MS);
  }
  return {
    KINDS: KINDS, LABEL: LABEL, apply: apply, set: set, cycle: cycle, tick: tick,
    startAuto: startAuto,
    kind: kind, isDegraded: function () { return _degraded; },
    isOn: function () { return kind() !== 'none' && !blocked(); },
    blockReason: blockReason,
    /* 供 UI 渲染的一行状态：选了哪档 + 是否真的在跑 + 没跑的原因 */
    describe: function () {
      const k = kind();
      return { kind: k, label: LABEL[k] || k, on: !blocked(), reason: blockReason(), degraded: _degraded };
    },
  };
})();
BF.amb.startAuto();
/* 设置面板改「背景氛围」/「减少动效」时立即生效（设置变更统一走 EVENTS.SETTINGS 事件）。
   注意：事件载荷的形态不保证是对象——BF.settings 广播的是设置快照，但其他模块
   也可能 emit 同名事件且传非对象（曾导致 'in' operator 报在每个设置变更上）。
   这里做类型守卫，非法载荷直接忽略。 */
try {
  BF.bus.on(BF.EVENTS.SETTINGS, function (s) {
    if (!s || typeof s !== 'object') return;
    if ('reduceMotion' in s) { document.body.classList.toggle('reduce-motion', !!s.reduceMotion); BF.amb.apply(); }
    if ('bgAnim' in s) BF.amb.apply();
  });
} catch (e) { BF.err.report('amb.bus', e); }

