/* ================= 19. BF.ui 基础 ================= */
/* BF.ui 必须用 Object.assign 合并赋值：`BF.ui = (function…)()` 整体赋值会抹掉
   本文件上方挂载的 blank / loading / error 三态组件——脚本顺序执行，
   先挂后抹，致通知中心 / 便签管理器 / 工作台任务栏
   空态 TypeError 崩溃。合并保留既有键，
   叠加本模块 startClock / setStatusDot / toast 三件。
   BF.modal（Esc 关闭 / 焦点归还已实现）为独立模块，与此无关。 */
BF.ui = Object.assign(BF.ui || {}, (function () {
  function startClock() {
    const el = document.getElementById('clock');
    const dateEl = document.getElementById('clock-date');
    if (!el) return;
    if (el.__bfClockOn) return;   /* 单例守卫：避免 install 与 boot 各启动一份（两个 1s 定时器同时改同一个时钟） */
    el.__bfClockOn = true;
    function tick() {
      const now = new Date();
      const p = n => String(n).padStart(2, '0');
      const t = p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
      /* 逐字符 span（缓存引用，仅字符串变化才重排；tick 动画由 CSS 驱动） */
      let spans = el.__spans;
      if (!spans || spans.length !== t.length) {
        el.innerHTML = t.split('').map(function (ch) { return '<span>' + ch + '</span>'; }).join('');
        spans = el.__spans = el.querySelectorAll('span');
      } else {
        for (let i = 0; i < t.length; i++) {
          if (spans[i].textContent !== t[i]) {
            spans[i].textContent = t[i];
            spans[i].classList.remove('tick');
            void spans[i].offsetWidth;
            spans[i].classList.add('tick');
          }
        }
      }
      if (dateEl) {
        /* 星期表提为常量、日期串只在跨日时重写——逐秒重算并重赋值是无效开销 */
        const dkey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
        if (el.__dateKey !== dkey) {
          el.__dateKey = dkey;
          const WEEKS = ['日', '一', '二', '三', '四', '五', '六'];
          dateEl.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + WEEKS[now.getDay()];
        }
      }
      /* 底栏时钟：同款 HH:MM（挂在 updateProgress 里，不滚动就 stale），
         这里复用已有的 1s tick 顺带刷新，不新增定时器 */
      const rt = document.getElementById('reader-time');
      if (rt) {
        const hm = t.slice(0, 5);
        if (rt.textContent !== hm) rt.textContent = hm;
      }
      /* 夜间自动的跨时段巡检：只在整点跃迁且开关开启时重算主题，避免每秒 apply */
      const h = now.getHours();
      if (h !== BF.ui._lastHour) { BF.ui._lastHour = h; if (BF.settings.get('autoTheme')) BF.theme.apply(); }
    }
    tick();
    BF.timers.interval(tick, 1000);
  }
  function setStatusDot(state) {
    const warn = state === 'warn';
    document.querySelectorAll('.status-dot').forEach(function (el) {
      el.className = 'status-dot' + (warn ? ' warn' : '');
      /* 状态点是唯一常驻失败指示器：必须带文本/title/aria-label，
         否则屏幕阅读器与普通用户都感知不到「存储写入失败」这一最高危告警。 */
      if (warn) {
        el.title = '存储写入失败：部分数据未能保存，请检查存储空间';
        el.setAttribute('aria-label', '存储写入失败：部分数据未能保存');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('role', 'status');
        el.textContent = '!';
      } else {
        el.removeAttribute('title');
        el.removeAttribute('aria-label');
        el.removeAttribute('aria-live');
        el.removeAttribute('role');
        el.textContent = '';
      }
    });
  }
  function toast(m, t, undoCb) {
    const type = t === 'err' ? 'error' : t === 'warn' ? 'warn' : 'success';
    BF.noti[type](m, undoCb ? { action: { label: '撤销', run: undoCb } } : undefined);
  }
  return { startClock, setStatusDot, toast };
})());

