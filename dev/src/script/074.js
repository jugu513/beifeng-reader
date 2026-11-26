/* ================= R9. 续读提示 ================= */
BF.reader.showResumeTip = function (b) {
  const tip = document.getElementById('resume-tip');
  if (!tip || !b || !b.lastRead) return;
  const now = new Date();
  if (now.getTime() - b.lastRead > 24 * 3600 * 1000) return;
  tip.textContent = '上次读到 ' + ((b.currentChapter || 0) + 1) + '/' + (b.totalChapters || '?') + ' 章，点击继续';
  /* 提示必须可点：挂 data-resume-read，点击由文档级全局委托接管 → 恢复章节 + 滚动位置；
     若只是静态文本无绑定，就是承诺「点击继续」却点不动。 */
  tip.setAttribute('data-resume-read', b.id);
  tip.classList.add('show');
  setTimeout(function () { tip.classList.remove('show'); }, 4000);
};

/* ============================================================
   北风 · reader 域（二）：抽屉 / 标注 / 工具条 / 查找 / 统计
   ============================================================ */

