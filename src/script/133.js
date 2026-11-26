/* ================= 分区注册表 ================= */
BF.settingsUI.sections = [];
BF.settingsUI.register = function (id, order, render) {
  BF.settingsUI.sections.push({ id, order, render });
  BF.settingsUI.sections.sort((a, b) => (a.order || 0) - (b.order || 0));
};
