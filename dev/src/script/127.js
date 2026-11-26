/* ================= 统计面板 ================= */
BF.statsPanel = (function () {
  /* 热力窗口 14/30/90 天，面板内切换（不持久化——
     统计是「打开看一眼」的场景，默认仍是 14 天）。 */
  let _range = 14;
  /* CSV 导出——日账（阅读/专注两列）整表导出。
     BOM 头保证 Excel 直接打开中文不乱码；下载链接 3s 后回收。 */
  function exportCsv() {
    try {
      const daily = BF.store.lsGet(BF.store.K.DAILY, {}) || {};
      const fd = BF.store.lsGet(BF.store.K.FOCUS_DAILY, {}) || {};
      const keys = Array.from(new Set(Object.keys(daily).concat(Object.keys(fd)))).sort();
      if (!keys.length) { BF.noti.warn('还没有任何统计数据可导出'); return; }
      const rows = ['日期,阅读分钟,专注分钟'].concat(keys.map(function (k) {
        return k + ',' + Math.round((daily[k] || 0) / 60) + ',' + Math.round((fd[k] || 0) / 60);
      }));
      const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const _d = new Date();
      a.download = '北风统计_' + _d.getFullYear() + String(_d.getMonth() + 1).padStart(2, '0') + String(_d.getDate()).padStart(2, '0') + '.csv';
      document.body.appendChild(a); a.click();
      BF.timers.timeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 3000);
      BF.noti.success('已导出 ' + keys.length + ' 天的统计 CSV');
    } catch (e) { BF.err.report('stats.exportCsv', e); BF.noti.error('CSV 导出失败'); }
  }
  function setRange(n) { _range = ([14, 30, 90].indexOf(n) >= 0) ? n : 14; render(); }
  function render() {
    const daily = BF.store.lsGet(BF.store.K.DAILY, {});
    const nums = document.getElementById('stats-nums');
    const days = document.getElementById('stat-days');
    if (nums) {
      const totalSec = Object.values(daily).reduce((a, b) => a + (Number(b) || 0), 0);
      /* 7 天窗只有一处实现（BF.stats.windowSum），此处与下面的专注周计共用 */
      const weekSec = BF.stats.windowSum(daily, 7);
      /* 新用户第一天不可能满 1 小时：Math.round(totalSec/3600) 恒为 0，
         第一屏统计就写着「0 小时累计」，等于告诉用户这功能没用。
         不足 1 小时改按分钟显示。 */
      const totalTxt = totalSec >= 3600 ? String(Math.round(totalSec / 3600)) : String(Math.round(totalSec / 60));
      const totalUnit = totalSec >= 3600 ? '小时累计' : '分钟累计';
      nums.innerHTML = '<div style="display:flex;gap:20px;flex-wrap:wrap"><div><span style="font-family:var(--mono);font-size:20px">' + totalTxt + '</span> ' + totalUnit + '</div>' +
        '<div><span style="font-family:var(--mono);font-size:20px">' + Math.round(weekSec / 60) + '</span> 分钟本周</div>' +
        '<div><span style="font-family:var(--mono);font-size:20px">' + BF.stats.todayDisplay() + '</span> 分钟今天</div></div>';
    }
    if (days) {
      const now = new Date();
      let html = '';
      /* 窗口按 _range 渲染；90 天条宽走 .is-dense 自适应、
         gap 由 JS 收窄（行内骨架写的 3px 优先级更高，类覆盖不了）。 */
      for (let i = _range - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i);
        const k = BF.stats.todayKey(d);
        const min = Math.round((daily[k] || 0) / 60);
        /* 原刻度 4 + min*2、56px 封顶：26 分钟以上全部同高，
           最近两周读不出「读了多少」的差别。sqrt 让 0–120 分钟铺满整段。 */
        const h = min > 0 ? Math.round(6 + 50 * Math.sqrt(Math.min(min, 120) / 120)) : 4;
        const lv = min >= 60 ? ' lv4' : min >= 30 ? ' lv3' : min >= 10 ? ' lv2' : min > 0 ? ' lv1' : '';
        const tip = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + min + ' 分钟';
        /* data-tip 是纯 CSS 伪元素提示，触屏与读屏都拿不到（全站没有键盘出口）：
           同一句话再挂 title + aria-label。 */
        html += '<div class="d' + (min > 0 ? ' filled' : '') + lv + '" style="height:' + h + 'px" data-tip="' + tip + '" title="' + tip + '" aria-label="' + tip + '"></div>';
      }
      days.innerHTML = html;
      days.classList.toggle('is-dense', _range > 30);
      days.style.gap = _range > 30 ? '1px' : '3px';
      const _t = document.getElementById('stat-days-title');
      if (_t) _t.textContent = '近 ' + _range + ' 天';
      document.querySelectorAll('[data-stat-range]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-stat-range'), 10) === _range));
      });
    }
    BF.goal.render();
    /* 今日专注块（番茄钟 → 统计打通）。
       focus_daily 为独立日账（秒），专注结束由
       BF.focus 写入；此处读出今日/本周分钟渲染。
       读失败降级为 0，不阻断统计面板其余部分。 */
    const sf = document.getElementById('stat-focus');
    if (sf) {
      let fToday = 0, fWeek = 0;
      try {
        const fd = BF.store.lsGet(BF.store.K.FOCUS_DAILY, {}) || {};
        fToday = Math.round((fd[BF.stats.todayKey()] || 0) / 60);
        /* 与阅读周计同一个窗口实现（BF.stats.windowSum），不再手抄第二份判据 */
        fWeek = Math.round(BF.stats.windowSum(fd, 7) / 60);
      } catch (e) { BF.log && BF.log.warn('store.专注日账读取失败，今日/本周专注会显示为 0 分钟：' + (e && e.message)); }
      sf.innerHTML = '<div style="font-size:12px;color:var(--text-dim);display:flex;justify-content:space-between;padding:3px 0">' +
        '<span>今日专注</span><span style="font-family:var(--mono)">' + fToday + ' 分钟' +
        (fWeek > 0 ? ' · 本周 ' + fWeek + ' 分钟' : '') +
        /* 目标纳入专注关闭时如实标注口径，避免用户误以为
           专注分钟在撑当日目标进度。空态（0 分钟）不标，留给空态文案。 */
        (fToday > 0 && !BF.settings.get('goalIncludeFocus') ? ' · 未计入阅读目标' : '') +
        (fToday ? '' : '（开始一次番茄钟后统计）') + '</span></div>';
    }
    const bl = document.getElementById('stats-books');
    if (bl) {
      const list = BF.stats.bookList ? BF.stats.bookList() : [];
      const meta = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
      if (!list.length && !meta.length) { bl.innerHTML = '<div style="color:var(--text-weak);padding:4px 0">暂无按书记录</div>'; }
      else {
        /* 有书但无时长记录时，也列出书名+0 分钟 */
        const _shown = list.slice(0, 20);
        const _rest = Math.max(0, list.length - _shown.length);
        const rows = _shown.map(function (x) {
          const b = meta.find(function (m) { return m.id === x.id; });
          /* 内部 id 前 8 位不是书名，用户看见的是一串乱码似的字符：
             查不到标题就直说「书名不可用」，别拿 id 冒充标题 */
          const name = b && b.title ? b.title : '（书名不可用）';
          const min = Math.round(x.sec / 60);
          return { name: name, min: min, has: true };
        });
        if (!rows.length) {
          meta.slice(0, 8).forEach(function (b) { rows.push({ name: b.title || '未命名', min: 0, has: false }); });
        }
        bl.innerHTML = rows.map(function (r) {
          return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">' + BF.dom.esc(r.name) + '</span>' +
            '<span style="font-family:var(--mono)">' + (r.min >= 60 ? Math.floor(r.min / 60) + ' 小时 ' + (r.min % 60) + ' 分钟' : r.min + ' 分钟') + '</span></div>';
        }).join('') +
          /* 截断要说出来：只列 20 本而不告诉用户还剩多少本，读起来像「就这些」 */
          (_rest ? '<div class="v4-heat-tip">其余 ' + _rest + ' 本未列出</div>' : '');
      }
    }
  }
  return { render, setRange, exportCsv };
})();
/* 兼容内置 DSL 脚本（「打开统计」）：它们调用 BF.statsPanel.open，
   open 转发 BF.wsUI.toggleStats（落到工作台「统计」栏；
   open 幂等：已开则复用并重渲染，未开则压栈打开），
   保证统计面板只有一份渲染实现。 */
BF.statsPanel.open = function () { if (BF.wsUI && BF.wsUI.toggleStats) BF.wsUI.toggleStats(); };
BF.statsPanel.toggle = BF.statsPanel.open;

