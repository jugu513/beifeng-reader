/* ================= 25. 启动 ================= */

/* 首启引导：仅在 K.ONBOARDED 未置位时显示三步浮条；点「不再显示」置位后永不再现。
   三步分别跳到导入 / 阅读排版设置 / 朗读设置入口；监听器用 onclick 属性挂（每次覆盖不叠加）。
   force=true 由「再看一次引导」传入：跳过「书架已有书」的自动收起判据。 */
BF.app.maybeOnboard = function (force) {
  const bar = document.getElementById('onboard-bar');
  if (!bar) return;
  let done = false;
  try { done = !!BF.store.lsGet(BF.store.K.ONBOARDED, false); } catch (e) { BF.log && BF.log.warn('storage.引导标记读取失败：' + (e && e.message)); }
  if (done) { bar.hidden = true; return; }
  /* 书架上有书就自动收起：这条浮条只负责「第一次怎么开始」，
     第一步（导入）已经走过去之后它还常驻，就成了背景噪声。
     force（设置里点「再看一次引导」）跳过这一判据，否则召回会被立刻收回去。 */
  if (!force) {
    let _hasBooks = false;
    try { _hasBooks = BF.store.lsGetArray(BF.store.K.BOOKS_META, []).length > 0; } catch (e) {}
    if (_hasBooks) {
      bar.hidden = true;
      try { BF.store.lsSet(BF.store.K.ONBOARDED, 1); } catch (e2) { BF.err.report('onboard.auto', e2); }
      return;
    }
  }
  bar.hidden = false;
  const title = bar.querySelector('.onboard-bar__title');
  const steps = bar.querySelectorAll('[data-onboard]');
  const seen = {};
  function markStep(k) {
    try { seen[k] = true; } catch (e) {}
    /* 三步全点过 → 落一个「已看完」弱态（不强关，用户可能还想点别的入口） */
    if (steps.length && Object.keys(seen).length >= steps.length) {
      try { bar.classList.add('onboard-bar--done'); } catch (e) {}
      if (title) title.textContent = '已看完引导 · 设置里可再看一次';
    }
  }
  bar.querySelectorAll('[data-onboard]').forEach(function (b) {
    b.onclick = function () {
      const k = b.getAttribute('data-onboard');
      markStep(k);
      try {
        if (k === 'import') { if (BF.library && BF.library.pickAndImport) BF.library.pickAndImport(); }
        /* 一个动作一个落点：排版步直达统一面板本身，不再落到「阅读」分区迷宫；
           朗读步直接开始朗读当前书，无书则提示先导入（不跳设置页）。 */
        else if (k === 'layout') { if (BF.settingsUI && BF.settingsUI.open) BF.settingsUI.open('readPanel'); }
        else if (k === 'tts') {
          if (BF.appState && BF.appState.currentBookId) { try { BF.tts.start(); } catch (e) { BF.err.report('onboard.tts', e); } }
          else BF.noti.info('先导入一本书，再点「开启朗读」即可听书');
        }
      } catch (e) { BF.err.report('onboard.step', e); }
    };
  });
  const close = bar.querySelector('[data-onboard-close]');
  if (close) close.onclick = function () {
    /* 这条落盘失败要出声：写不进去 = 下次启动引导条又回来，
       用户会以为自己没点过。 */
    try { BF.store.lsSet(BF.store.K.ONBOARDED, 1); } catch (e) { BF.err.report('onboard.dismiss', e); }
    bar.hidden = true;
  };
};
/* 导入不必等下一次刷新：书架一变就重看一次引导条（上面的函数是幂等的，收起后不会再回来）。 */
try { BF.bus.on(BF.EVENTS.BOOKSHELF, function () { try { BF.app.maybeOnboard(); } catch (e) { BF.err.report('onboard.books', e); } }); } catch (e) { BF.err.report('onboard.bind', e); }

/* 最严重错误链：恢复失败且数据未能还原时，用不可关闭的红框对话框承载，
   并在对话框里直接打开备份文件选择器（会自消散的 toast 承载不了这条）。
   锚点文案「恢复失败且数据未能还原」字节不变（仅换展示层）；对话框无 X、屏蔽 backdrop/Esc，
   仅两条出口：选备份文件（委托 BF.bk.importFile 走既有导入+确认+恢复链）、去数据面板。 */
BF.app.recoveryFailedDialog = function (msg) {
  try {
    if (document.getElementById('bf-recovery-dlg')) return;   /* 防重入 */
    const ov = document.createElement('div');
    ov.className = 'bf-recovery-ov';
    ov.id = 'bf-recovery-dlg';
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML =
      '<div class="bf-recovery-box" tabindex="-1">' +
        '<div class="bf-recovery__head">数据恢复失败</div>' +
        '<div class="bf-recovery__msg"></div>' +
        '<p class="bf-recovery__hint">本机数据未能还原。从自己的 JSON 备份恢复，或前往「数据」面板处理（导入备份 / 重置）。</p>' +
        '<label class="bf-recovery__pick"><span>选择备份文件（.json）</span>' +
          '<input type="file" accept=".json,application/json" class="bf-recovery__file"></label>' +
        '<div class="bf-recovery__actions">' +
          '<button type="button" class="btn btn-sm" data-rec-go>去数据面板</button>' +
        '</div>' +
      '</div>';
    /* 锚点文案经 textContent 写入，避免任何注入面 */
    ov.querySelector('.bf-recovery__msg').textContent = (msg || '恢复失败且数据未能还原');
    /* 不可关闭：点 backdrop 不关（事件冒泡到 ov 即停），无 X；Esc 也不在此栈内 */
    ov.addEventListener('click', function (e) { if (e.target === ov) e.stopPropagation(); });
    document.body.appendChild(ov);
    try { ov.querySelector('.bf-recovery-box').focus(); } catch (eFocus) {}
    const file = ov.querySelector('.bf-recovery__file');
    if (file) file.addEventListener('change', function () {
      try { if (BF.bk && BF.bk.importFile) BF.bk.importFile(file); } catch (eImp) { BF.err.report('recovery.dlg.import', eImp); }
      _close();   /* 交给标准导入/确认/恢复流程，dialog 退场 */
    });
    const go = ov.querySelector('[data-rec-go]');
    if (go) go.addEventListener('click', function () {
      try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e) {}
      _close();
    });
    function _close() { try { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }
  } catch (e) { BF.err.report('recoveryFailedDialog', e); }
};

