/* ===== 骨架屏 API=====
两条硬约束：
  1. 真实数据返回后必须立刻被替换 —— 故 skeleton 只是「占位」，
     真实内容一就绪就整体 innerHTML 覆盖，不做增量拼接。
  2. 空书架状态不能被骨架屏误盖 —— 调用方负责：books.length === 0 时不得调用 show。
kind: 'card'（书架网格）/ 'row'（目录列表） */
/* 命名空间选择（覆盖陷阱）：不要挂 BF.ui —— 文件第 19 节有
   `BF.ui = (function{...})` 整体赋值，会把这里挂的东西静默抹掉。
   BF.app 是全文件唯一一次的对象字面量定义（无后续整体覆盖），挂这里安全。 */
BF.app.skeleton = function (el, n, kind) {
  if (!el) return;
  n = Math.max(1, Math.min(Number(n) || 6, 24));
  if (kind === 'row') {
    /* new Array(n).join(x) 只会拼出 n-1 份 ⇒ 要 6 行给 5 行。
       与下面 card 分支的 for 计数同一口径。 */
    el.innerHTML = new Array(n + 1).join('<div class="skeleton skeleton-row"></div>');
    return;
  }
  let h = '';
  for (let i = 0; i < n; i++) {
    h += '<div class="skeleton-card">' +
      '<div class="skeleton sk-cover"></div>' +
      '<div class="skeleton sk-line"></div>' +
      '<div class="skeleton sk-line short"></div>' +
      '</div>';
  }
  el.innerHTML = h;
};

