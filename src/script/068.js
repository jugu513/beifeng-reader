/* ================= R6. 导航 ================= */
/* 微读模式：三栏专注布局（DOM 在 reader 段建）。 */
BF.reader.toggleMicroread = function () {
  const page = document.getElementById('page-reader');
  if (!page) return;
  const on = page.classList.toggle('microread');
  BF.settings.set('microread', on);
  BF.noti.info(on ? '微读模式开启（Esc 退出）' : '已退出微读模式');
};
BF.reader.exitMicroread = function () {
  const page = document.getElementById('page-reader');
  if (!page || !page.classList.contains('microread')) return;
  page.classList.remove('microread');
  BF.settings.set('microread', false);
  BF.noti.info('已退出微读模式');
  BF.mr && BF.mr.destroy();
};
