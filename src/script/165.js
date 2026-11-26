/* ================= 18. BF.noti 通知系统 ================= */
BF.noti = (function () {
  const MAX_HIST = BF.CONFIG.NOTI_HIST_MAX;
  const MAX_VISIBLE = BF.CONFIG.NOTI_VISIBLE_MAX; /* 同屏卡片上限。批量导出 50 本会一次性堆 50 个 DOM + 50 个定时器 */
  let _badge = 0;
  var _live = {};   /* type+message → 当前可见卡片，用于同文案去重计数 */
  function hist() { return BF.store.lsGetArray(BF.store.K.NOTI_HIST, []); }
  function _pushHist(rec) {
    const h = hist();
    /* 已读口径不写在每条记录上，而是一个「上次看过」时刻（见 markSeen）：
       进面板就替用户标已读，等于替用户决定他看过没看过。 */
    h.unshift(rec);
    if (h.length > MAX_HIST) h.length = MAX_HIST;
    /* 历史是「卡片没被看见时唯一的回响」：落盘失败要出声，不能静默缩短 */
    if (BF.store.lsSet(BF.store.K.NOTI_HIST, h) !== true) {
      try { if (BF.ui && BF.ui.setStatusDot) BF.ui.setStatusDot('warn'); } catch (e) {}
    }
  }
  function _show(type, message, opts) {
    opts = opts || {};
    const wrap = document.getElementById('noti-wrap');
    /* 无障碍：通知容器带 role=status + aria-live=polite，动态插入
       的卡片才会被读屏播报（否则听不到任何通知，含最高危的存储告警）；
       error 级卡片再以 role=alert 提升为即时播报（assertive）。 */
    if (wrap && !wrap.hasAttribute('aria-live')) {
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
    }
    /* 吐司之外的三样留痕（历史 / 未读角标 / 桌面通知）是「卡片没被看见」时唯一的回响：
       通知中心靠历史、铃铛靠角标、后台标签页靠桌面通知。它们必须每次都记，
       所以抽成尾函数 —— 新卡路径和去重路径都调它，不分叉写两份。 */
    function _tail() {
      if (!opts.silent) {
        _pushHist({ type, message, t: Date.now() });
        if (opts.onDesktop !== false && type !== 'loading' && BF.settings.get('desktopNoti') !== false &&
          document.visibilityState === 'hidden' && 'Notification' in window) {
          try { new Notification('北风', { body: message, silent: true }); } catch (e) {}
        }
      }
      if (type === 'ok' || type === 'warn' || type === 'err') {
        _badge++;
        try { BF.bus.emit(BF.EVENTS.NOTI, { badge: _badge }); } catch (e) {}
      }
    }
    /* 同文案去重计数——连发同 type+message 时不再堆多张卡，
       而是在原卡上累加 ×N 并刷新停留时长，避免刷屏。
       去重收起的只是重复卡片：历史与角标照记（早退吞掉它们 = 用户以为只发生过一次）。 */
    const _key = type + ' ' + message;
    if (_live[_key] && _live[_key].parentNode) {
      const ec = _live[_key];
      ec._n = (ec._n || 1) + 1;
      let cnt = ec.querySelector('.n-count');
      if (!cnt) {
        cnt = document.createElement('span'); cnt.className = 'n-count'; cnt.textContent = '';
        /* 计数挂在正文之后、关闭键之前：追在卡片尾巴上会排到「×」后面，读起来像第二个关闭键 */
        const cl = ec.querySelector('.n-close');
        if (cl) ec.insertBefore(cnt, cl); else ec.appendChild(cnt);
      }
      cnt.textContent = '×' + ec._n;
      /* 去重命中时刷新动作闭包：同一 type+message 的不同次事件可能带不同的
         重试动作（如两次不同选区的朗读失败，消息相同但「重讲」应针对各自文本）。
         不刷新的话卡片仍绑第一次的 action，点「重讲本选区」会重讲上一段旧文本。 */
      if (opts.action && opts.action.label) {
        const actBtn = ec.querySelector('.n-act');
        if (actBtn) {
          actBtn.textContent = opts.action.label;
          actBtn.onclick = function () { try { opts.action.run(); } catch (e) { BF.err.report('noti.action', e); } if (ec._removeFn) ec._removeFn(); };
        }
      }
      if (ec._cancel) { try { ec._cancel(); } catch (e) {} ec._cancel = null; }
      /* 判据必须是 'err'（_show 收到的档位）：写成 'error' 永不命中，错误卡退化成 3.5s */
      const dur = opts.duration || (type === 'err' ? 15000 : 3500);
      if (dur > 0 && BF.timers && BF.timers.timeout) ec._cancel = BF.timers.timeout(function () { if (ec._removeFn) ec._removeFn(); }, dur);
      else if (dur > 0) ec._t = setTimeout(function () { if (ec._removeFn) ec._removeFn(); }, dur);
      _tail();
      return;
    }
    /* 免打扰：只收卡片，不吞反馈 —— 历史与未读照记（_tail 仍在），
       且故障级(err)永远弹卡：错误看不见就等于没通知。 */
    if (BF.settings.get('notiMute') && type !== 'err') { _tail(); return; }
    const card = document.createElement('div');
    card.className = 'noti-card ' + type;
    /* 级别判据用 'err'（_show 收到的是 ok/warn/err/info），不是 'error'：
       写错一档时故障卡只会挂 role=status，读屏等用户移动焦点才播报，
       与上面「error 级以 alert 即时播报」的承诺相反。 */
    card.setAttribute('role', type === 'err' ? 'alert' : 'status');
    const msg = document.createElement('div');
    msg.className = 'n-msg';
    msg.textContent = message;
    card.appendChild(msg);
    if (opts.action && opts.action.label) {
      const a = document.createElement('button');
      a.className = 'n-act';
      a.textContent = opts.action.label;
      a.onclick = function () { try { opts.action.run(); } catch (e) { BF.err.report('noti.action', e); } remove(); };
      card.appendChild(a);
    }
    const close = document.createElement('button');
    close.className = 'n-close';
    close.textContent = '×';
    close.onclick = remove;
    card.appendChild(close);
    card._key = _key; card._removeFn = remove;
    _live[_key] = card;   /* 登记到去重表，连发同文案时 _show 命中并累加 ×N */
    function remove() {
      if (card._removed) return;
      card._removed = true;
      if (card._key && _live[card._key] === card) delete _live[card._key];
      /* 退场动画：不带过渡直接移除，多条通知同时消失会「啪」地跳变。
         降级动效时立即移除，不留残影。 */
      const rm = function () {
        if (card.parentNode) card.parentNode.removeChild(card);
      };
      /* 走 BF.timers 以便 clearAll 统一清理（裸 setTimeout 不受定时器治理约束） */
      if (card._cancel) { try { card._cancel(); } catch (e) {} card._cancel = null; }
      const reduce = (function () {
        try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
      })();
      if (reduce || !card.animate) { rm(); return; }
      try {
        const anim = card.animate(
          [{ opacity: 1, transform: 'translateX(0) scale(1)' },
           { opacity: 0, transform: 'translateX(16px) scale(.98)' }],
          { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
        anim.onfinish = rm;
        anim.oncancel = rm;
        /* 兜底：动画被打断（元素被移出 DOM 等）时也要清理，走 timers 治理避免裸定时器残留 */
        if (BF.timers && BF.timers.timeout) BF.timers.timeout(rm, 400); else setTimeout(rm, 400);
      } catch (e) { rm(); }
    }
    if (wrap) {
      /* 超上限时先摘最旧一张（连带取消其定时器），再挂新的 */
      while (wrap.children.length >= MAX_VISIBLE) {
        const oldest = wrap.firstElementChild;
        if (!oldest) break;
        if (oldest._cancel) { try { oldest._cancel(); } catch (e) {} oldest._cancel = null; }
        if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
      }
      wrap.appendChild(card);
      /* 失败类吐司不该和「已保存」用同一个 3.5 秒：错误信息消失得比读它的速度还快，
         等于没通知。给 err 类一档长停留（仍会自动收，不留永久残留）。
         判据必须是 'err'（_show 收到的档位）：写成 'error' 永不命中。 */
      const dur = opts.duration || (type === 'err' ? 15000 : 3500);
      if (dur > 0 && BF.timers && BF.timers.timeout) card._cancel = BF.timers.timeout(remove, dur);
      else if (dur > 0) { card._t = setTimeout(remove, dur); }
    }
    _tail();
  }
  return {
    success: function (m, o) { _show('ok', m, o); },
    warn: function (m, o) { _show('warn', m, o); },
    error: function (m, o) { _show('err', m, o); },
    info: function (m, o) { _show('info', m, o); },
    history: hist,
    /* 未读口径与铃铛角标是两套独立事实：角标是这一阵的提醒压力（点铃铛即清），
       未读是历史里的账 —— 用「上次看过」时刻算，不由系统替用户判定已读。 */
    unreadCount: function () {
      try { const seen = Number(BF.settings.get('notiSeenAt')) || 0; return hist().filter(function (x) { return (x.t || 0) > seen; }).length; } catch (e) { return 0; }
    },
    markSeen: function () { try { BF.settings.set('notiSeenAt', Date.now()); return true; } catch (e) { BF.log && BF.log.warn('store.通知已读时刻写入失败：' + (e && e.message)); return false; } },
    clearHistory: function () {
      /* 清空历史必须可撤销（销毁用户可见数据却给不出一条回响，就是假反馈）。
         走唯一撤销通道 act.run，不做裸 BF.undo.push。 */
      var prev = BF.store.lsGetArray(BF.store.K.NOTI_HIST, []);
      if (BF.act && BF.act.run) {
        BF.act.run('清空通知历史', function () { BF.store.lsSet(BF.store.K.NOTI_HIST, []); }, {
          /* 通知历史不属于任何一本书：登记时显式不带书归属，
             否则「边读书边清空历史 → 换一本再按撤销」会被跨书判据误拦。 */
          bookId: null,
          undo: function () { BF.store.lsSet(BF.store.K.NOTI_HIST, prev); },
          success: '已清空通知历史',
        });
      } else {
        BF.store.lsSet(BF.store.K.NOTI_HIST, []);
      }
    },
    badge: function () { return _badge; },
    resetBadge: function () { _badge = 0; },
  };
})();

