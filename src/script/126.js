/* ================= 阅读目标 ================= */
BF.goal = (function () {
  function get() { return BF.settings.num('readGoal', 30); }
  /* focus_daily 读取端。专注结束时把时长（秒）
     写入独立键 focus_daily（BF.focus._start，避免与阅读计时器
     重复计数），此处读出今日分钟并入
     todayMin，目标达成提示与「今日 X 分钟」显示随之含专注时长。
     是否纳入改为可配（goalIncludeFocus，默认关）——
     专注与阅读是两回事，默认不混计阅读目标口径；开启后
     专注时长并入，目标达成判定随之含专注。
     键经 K 表真源（BF.store.K.FOCUS_DAILY），
     不散写字面键名。 */
  function _focusTodayMin() {
    if (!BF.settings.get('goalIncludeFocus')) return 0;
    try {
      const fd = BF.store.lsGet(BF.store.K.FOCUS_DAILY, {}) || {};
      const k = BF.stats.todayKey();
      return Math.round((fd[k] || 0) / 60);
    } catch (e) { return 0; }
  }
  /* 含尚未落盘的累计分钟，避免目标达成后要等 5 分钟 flush 才感知 */
  function todayMin() { return BF.stats.todayDisplay() + _focusTodayMin(); }
  /* 目标为 0 = 不设目标。数值读法走 num() 时 0 会如实落进来
     （`parseInt(...)||30` 那种读法会把 0 当没设），这里必须跟着分叉：
     除 0 会得到 Infinity% 、check 也会立刻判「已达成」。 */
  function noGoal() { return get() <= 0; }
  function pct() {
    if (noGoal()) return 0;
    return Math.min(100, Math.round(todayMin() / get() * 100));
  }
  let _notifiedToday = '';
  function check() {
    const today = todayMin();   /* 用含未落盘累计的值，否则目标达成要等 5 分钟 flush 才感知 */
    if (noGoal()) return;       /* 未设目标不判达成，也不每天弹一次「已达成」 */
    const key = BF.stats.todayKey();
    if (today >= get() && _notifiedToday !== key) {
      _notifiedToday = key;
      /* BF.next.afterGoal 接线：达成态 toast 带下一步动作，
         与 afterBackup 同一契约。 */
      BF.noti.success('今日阅读目标已达成（' + today + ' 分钟）',
        (BF.next && BF.next.afterGoal) ? BF.next.afterGoal() : undefined);
    }
  }
  function render() {
    const el = document.getElementById('goal-display');
    if (!el) return;
    el.innerHTML = '<div style="font-size:13px">今日 ' + todayMin() + ' 分钟' +
      (noGoal() ? '（未设目标）' : ' / 目标 ' + get() + ' 分钟') + '</div>' +
      '<div style="height:6px;background:var(--bg-input);border-radius:3px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct() + '%;background:var(--accent);border-radius:3px"></div></div>';
  }
  return { get, todayMin, pct, check, render, noGoal };
})();
/* 未达成收束。当日 22:00 若已设目标且实际 <50%，提一次
   「今天还差 N 分钟」。只在每次启动时排**当次会话**的一个一次性定时器
   （BF.timers.timeout，不常驻、不隔天接力）；启动时已过 22:00 不补提
   （深夜打开 app 再弹「你还没读书」是打扰不是提醒）。 */
BF.goal.scheduleNightlyCheck = function () {
  try {
    const now = new Date();
    const at = new Date(now); at.setHours(22, 0, 0, 0);
    const ms = at.getTime() - now.getTime();
    if (ms <= 0) return;
    BF.timers.timeout(function () {
      try {
        if (BF.goal.noGoal()) return;   /* 未设目标不判达成，同 check 的守卫 */
        const got = BF.stats.todayDisplay();
        const need = BF.goal.get();
        if (got < need * 0.5) {
          BF.noti.warn('今天还差 ' + Math.max(1, need - got) + ' 分钟达成阅读目标（当前 ' + got + ' 分钟）');
        }
      } catch (e) { BF.err.report('goal.nightCheck', e); }
    }, ms);
  } catch (e) { BF.err.report('goal.nightSchedule', e); }
};
/* focus.onChange 的真实订阅者：专注状态变化（开始/暂停/结束/休息切换）
   会改变「今日投入」口径（focus_daily 写入），目标面板随之重渲染。
   注意 onChange 实际由 _render 末尾触发，计时中每秒刻度都会调用——
   statsPanel.render 开头无条件 lsGet(DAILY)，每秒一次存储读 +
   goal.render 每秒一次 DOM 重绘。因此订阅回调内做分钟级数值比对
   （状态 + 当前段已过分钟，_focusMinuteSig）——专注分钟数变化
   （开始/结束/休息切换/分钟进位）才执行下游，每秒刻度不触发
   无谓渲染与存储读取。 */
function _focusMinuteSig() {
  const st = (BF.focus && BF.focus.state) ? BF.focus.state() : null;
  if (!st) return 'idle:0';
  const _m = Math.floor(((st.total || 0) - (st.left || 0)) / 60);
  return st.state + ':' + _m;
}
/* 达成判定与统计重绘合用一个订阅：一份分钟级签名、一次比对——
   拆成两个订阅者就各持一份签名、各订阅一次 onChange，
   等于两个独立的「每秒比对、分钟级放行」判定在重复劳动。
   两个消费者各自 try/catch，互不因对方异常而跳过。 */
let _lastFocusSig = null;
BF.focus.onChange(function () {
  const _sig = _focusMinuteSig();
  if (_sig === _lastFocusSig) return;   /* 分钟级比对：秒刻度不触发 */
  _lastFocusSig = _sig;
  try {
    if (BF.goal && BF.goal.render) BF.goal.render();
    /* 目标纳入专注开启时，专注时长并入今日口径，
       达标判定随之触发（check 有日守卫，同日不重复通知） */
    if (BF.goal && BF.goal.check) BF.goal.check();
  } catch (e) { BF.err.report('goal.minuteTick', e); }
  try {
    /* 统计栏消费端：专注状态变化改写「今日专注」口径
       （专注结束写入 focus_daily），统计栏随之重渲染，
       无需手动重开面板。 */
    if (BF.statsPanel && BF.statsPanel.render) BF.statsPanel.render();
  } catch (e) { BF.err.report('stats.minuteTick', e); }
});
