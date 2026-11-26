/* ================= 9. BF.commands 命令系统 ================= */
BF.commands = (function () {
  const list = [];
  function register(cmd) {
    if (!cmd || !cmd.id) return null;
    cmd.label = cmd.label || cmd.id;
    /* 同名注册拒绝覆盖：保留先注册者、warn 留痕、
       返回 null 示意注册未生效（确需更新请先 unregister
       再注册）——若静默让后注册者顶掉先注册者，命令表就沦为
       「谁最后加载谁说话」，且 hub 收编视图与真相表可能
       指向不同实现。全库 86 个注册调用零静态重复；DSL syncCommands
       本就带 existing.some 守卫，插件热更新走 unregister→register
       两步，均不受影响。 */
    const i = list.findIndex(c => c && c.id === cmd.id);
    if (i >= 0) {
      BF.log && BF.log.warn('命令「' + cmd.id + '」已注册，拒绝覆盖（保留先注册者；确需更新请先 unregister）');
      return null;
    }
    list.push(cmd);
    return cmd;
  }
  function run(id) {
    const c = list.find(x => x && x.id === id);
    if (!c) { BF.log && BF.log.warn('命令不存在：' + id); return false; }
    try { c.run(); return true; } catch (e) { BF.err.report('cmd:' + id, e); return false; }
  }
  /* 注销 API：插件经 _wire 把 commands[] 登记到命令注册表，
     卸载（_uninstallOne → _unwire）就必须连同命令一起摘除——
     否则插件禁用后其命令仍留在命令注册表，成为指向已卸载
     代码的死命令。register 的镜像操作，同一套账只清 list。 */
  function unregister(id) {
    const i = list.findIndex(c => c && c.id === id);
    if (i >= 0) list.splice(i, 1);
    return true;
  }
  return { register, unregister, run, list: () => list.slice() };
})();

