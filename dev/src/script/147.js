/* ================= 章节截图（canvas 生成卡片图） ================= */
BF.enh.chapterScreenshot = function () {
  if (BF.appState.currentPage !== 'reader' || !BF.appState.currentBookId) { BF.noti.warn('请先打开一本书再截图'); return; }
  const b = BF.reader.state.book;
  const title = BF.reader.state.title || '第' + (BF.appState.currentChapterIdx + 1) + '章';
  const body = (document.getElementById('reader-main') || {}).textContent || '';
  const text = body.replace(/\s+/g, ' ').trim().slice(0, 1000);
  const W = 760, H = 1060;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#faf7f2'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3a3a3a';
  ctx.font = '600 26px "Noto Serif SC", serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, 70);
  ctx.strokeStyle = '#d9c9a8';
  ctx.beginPath(); ctx.moveTo(W / 2 - 60, 92); ctx.lineTo(W / 2 + 60, 92); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = '15px "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#444';
  const max = W - 80; let y = 130, x = 40;
  const chars = [...text];
  for (const ch of chars) {
    if (ch === '\n') { y += 28; x = 40; continue; }
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + 2;
    if (x > max) { x = 40; y += 28; }
    if (y > H - 40) break;
  }
  try {
    cv.toBlob(function (blob) {
      BF.download(title.replace(/[^\w\u4e00-\u9fa5]/g, '_') + '_截图.png', blob);
      BF.noti.success('章节截图已生成');
    }, 'image/png');
  } catch (e) { BF.err.report('chapterScreenshot', e); BF.noti.error('截图失败'); }
};

