/* ================= L8. 导入进度 UI =================
   openImport/closeImport 是导入链路的天然生命周期边界（所有导入通道最终都会走到），
   在这里挂 BF.jobs 打点，运维台「进程」页就能看到"正在导入"，无需改动 importFiles 主流程。 */
let _importJobId = 0;
BF.app.openImport = function (ctrl) {
  const bg = document.getElementById('import-bg');
  /* 收进 sheet 才能进浮层栈，否则「谁开着」只能由
     导入自己列 ['cmd-mask','modal-bg'] 来判断。
     esc:false —— Esc 不归 sheet，仍由下面的导入取消逻辑解释（关掉层不中止任务
     会造成「进度条没了、书还在导」的假象）。lock:false —— 不锁滚动。 */
  if (bg) BF.sheet.open('import-bg', { cls: 'show', tier: 'overlay', esc: false, lock: false, autofocus: false });
  /* 导入取消：取消按钮
     监听（幂等——静态 HTML 只注册一
     次）；任务登记 ctrl，任务中心的
     「取消」与面板按钮 / ESC 走同一
     中止导入路径。 */
  const cancelBtn = document.getElementById('import-cancel');
  if (cancelBtn && !cancelBtn.__bfCancelOn) {
    cancelBtn.__bfCancelOn = true;
    cancelBtn.addEventListener('click', function () { BF.library.cancelImport(); });
  }
  if (!_importJobId && BF.jobs && BF.jobs.begin) {
    try { _importJobId = BF.jobs.begin('导入书籍', { kind: 'import', detail: '解析与分章', ctrl: ctrl || null }); } catch (e) {}
  }
};
BF.app.setImport = function (p, t) {
  const fill = document.getElementById('import-fill');
  const txt = document.getElementById('import-text');
  if (fill) { fill.style.width = p + '%'; fill.setAttribute('aria-valuenow', String(Math.round(p))); }
  if (txt) txt.textContent = t;
  /* 把进度写进任务详情，进程页无需另开通道就能看到百分比 */
  if (_importJobId && BF.jobs) { try { BF.jobs.setDetail(_importJobId, Math.round(p) + '% · ' + (t || '')); } catch (e) {} }
};
BF.app.closeImport = function () {
  const bg = document.getElementById('import-bg');
  if (bg) BF.sheet.close('import-bg');
  if (_importJobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(_importJobId); } catch (e) {} }
  _importJobId = 0;
};

