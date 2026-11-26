/* ================= 通知中心 ================= */
BF.notiCenter = (function () {
  /* 分级筛选：连发 6 条同文案 → 5 张卡 + 5 条历史，无合并无去重；
     更关键的是 error 与「已保存」混在一个池子里 —— 用户分不清哪三条是写盘失败。
     未读用「上次看过」时刻算，不替用户判定已读；标已读是一个显式动作。 */
  const FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'unread', label: '未读' },
    { id: 'warn', label: '提醒' },
    { id: 'err', label: '故障' },
  ];
  let _filter = 'all';
  let _wired = false;
  const match = function (h, id, seen) {
    if (id === 'unread') return (h.t || 0) > seen;
    if (id === 'warn') return h.type === 'warn';
    if (id === 'err') return h.type === 'err';
    return true;
  };
  function render() {
    const hist = BF.noti.history();
    const body = document.getElementById('noti-center-body');
    if (!body) return;
    if (!_wired) {
      _wired = true;
      /* 一处委托，不给每颗 chip 挂监听；面板重建后 body 是同一个容器，不会叠加 */
      body.addEventListener('click', function (ev) {
        const chip = ev.target.closest ? ev.target.closest('[data-nc-filter]') : null;
        if (chip) { _filter = chip.getAttribute('data-nc-filter'); render(); return; }
        const seen = ev.target.closest ? ev.target.closest('[data-nc-seen]') : null;
        if (seen) { BF.noti.markSeen(); render(); }
      });
    }
    const seenAt = Number(BF.settings.get('notiSeenAt')) || 0;
    const unread = hist.filter(function (h) { return match(h, 'unread', seenAt); }).length;
    /* 空态走统一三态组件（.rd-blank 模式），样式与语义统一。 */
    if (!hist.length) { body.innerHTML = BF.ui.blank({ icon: BF.dom.ic('noti'), msg: '暂无通知' }); return; }
    const chips = '<div class="nc-filters" role="group" aria-label="通知分级筛选">' + FILTERS.map(function (f) {
      const n = hist.filter(function (h) { return match(h, f.id, seenAt); }).length;
      return '<button type="button" class="nc-chip" data-nc-filter="' + f.id + '"' +
        (_filter === f.id ? ' aria-current="true"' : '') + '>' + f.label + '（' + n + '）</button>';
    }).join('') + '</div>';
    const act = unread > 0 ? '<div class="nc-actions"><button type="button" class="btn btn-xs" data-nc-seen>标为已读</button></div>' : '';
    const list = hist.filter(function (h) { return match(h, _filter, seenAt); }).slice(0, 50).map(function (h) {
      return '<div class="nc-item"><div class="nc-item__msg">' +
        ((h.t || 0) > seenAt ? '<i class="nc-unread" aria-label="未读"></i>' : '') +
        '<span class="nc-dot" data-level="' + BF.dom.escAttr(h.type || 'info') + '">●</span>' +
        '<span>' + BF.dom.esc(h.message) + '</span></div>' +
        '<div class="nc-item__t">' + new Date(h.t).toLocaleString('zh-CN') + '</div></div>';
    }).join('');
    body.innerHTML = chips + act + (list || '<div class="nc-item">这一档里还没有通知</div>');
  }
  return { render: render };
})();

/* ============================================================
   北风 · workspace 域（二）：DSL 终端 / 工具面板 UI / 命令注册
   ============================================================ */

