/* ================= 24. 模块注册 ================= */
(function () {
  BF.modules.register({ id: 'core.bus', tags: ['核心', '事件'], hooks: { install() { BF.log.info('bus ready'); } } });
  BF.modules.register({ id: 'core.store', tags: ['核心', '存储'], deps: ['core.bus'], hooks: { install() { BF.log.info('store ready'); } } });
  BF.modules.register({ id: 'core.settings', tags: ['核心', '设置'], deps: ['core.store'], hooks: { install() { BF.settings.load(); BF.log.info('settings ready'); } } });
  BF.modules.register({ id: 'core.sheet', tags: ['核心', '界面', '面板'], hooks: { install() { BF.log.info('sheet ready'); } } });
  BF.modules.register({ id: 'core.noti', tags: ['核心', '界面', '通知'], deps: ['core.store', 'core.settings'], hooks: { install() { BF.log.info('noti ready'); } } });
  BF.modules.register({ id: 'core.timers', tags: ['核心', '运行时'], hooks: { install() { BF.log.info('timers ready'); }, uninstall() { BF.timers.clearAll(); } } });
  BF.modules.register({ id: 'core.ui', tags: ['核心', '界面'], deps: ['core.timers'], hooks: { install() { BF.ui.startClock(); BF.log.info('ui ready'); } } });
    BF.modules.register({ id: 'enh.v4', tags: ['增强'], deps: ['core.settings', 'core.store'], hooks: { install() { try { BF.enh.v4.install(); BF.log.info('enh.v4 ready'); } catch (e) { BF.err.report('enh.v4.install', e); } } } });
BF.modules.autoregister();   /* 扫描 BF.* 生成轻量插件条目（含本文件内全部内置模块） */
  try { BF.dsl.syncCommands(); } catch (e) { BF.err.report('dsl.syncCommands', e); }   /* DSL 启用脚本注册为命令 */
})();

