/* ================= L5b. 统一另存为（导出端 FSA 优先，降级 <a download>） =================
   showSaveFilePicker 为 的保存端补充：支持时唤起原生「另存为」对话框（可自选目录），
   不支持（如 file:// 本地打开）或用户取消/异常时降级为 <a download>，保证永远能保存 */
/* 文件名消毒：书名/笔记名等用户可控文本会流到 showSaveFilePicker 与 <a download>，
   含 /\:*?"<>| 时前者抛错降级、后者在部分浏览器直接失败。统一入口清洗一次。 */
BF.sanitizeFilename = function (name) {
  let s = String(name == null ? '' : name);
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');   /* 非法字符 + 控制字符 */
  s = s.replace(/\.{2,}/g, '_');                       /* 路径穿越：.. 与 ... 一并中和 */
  s = s.replace(/^\.+/, '_');                          /* 不可以点开头（隐藏文件/相对路径语义） */
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = 'download';
  if (s.length > 120) s = s.slice(0, 100) + '_' + s.slice(-15);   /* 超长截断，保留可辨识后缀 */
  return s;
};
BF.download = async function (filename, blob) {
  const name = BF.sanitizeFilename(filename);
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = (name.match(/\.([a-z0-9]+)$/i) || [, 'txt'])[1].toLowerCase();
      const MIME = { txt: 'text/plain', json: 'application/json', zip: 'application/zip', png: 'image/png', md: 'text/markdown', html: 'text/html' }[ext] || 'application/octet-stream';
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: '文件', accept: { [MIME]: ['.' + ext] } }] });
      const ws = await handle.createWritable();
      await ws.write(blob); await ws.close();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        /* 取消也是一次有结果的操作：不给回执，用户只能靠「文件在不在下载目录」猜。
           原生对话框这一层的取消发生在页面之外，进不了操作日志，只能在出口处说一句。 */
        BF.noti.info('已取消保存');
        return false;
      }
      BF.err.report('savePicker', e);
      /* 非取消异常 → 落到下方降级 */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  return true;
};

/* 复制到剪贴板的唯一实现：优先剪贴板 API，只有它不可用才临时借一次 textarea。
   textarea 这条降级路会把文本短暂放进 DOM，所以用完立刻摘掉，且不显示出来。
   这里不落日志、不写存储：密钥这类内容经过任何一处留痕，就等于替用户出了门。 */
BF.copyText = async function (text) {
  const s = String(text == null ? '' : text);
  if (!s) return { ok: false, error: '没有内容可复制' };
  let why = 'unavailable';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
      return { ok: true, n: s.length };
    }
  } catch (e) { why = (e && e.message) || String(e); }
  try {
    const ta = document.createElement('textarea');
    ta.value = s; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.opacity = '0';
    /* 摘除放 finally：execCommand 抛错时也要把暂存的正文（可能是密钥）从 DOM 上撤掉 */
    try {
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      if (ok) return { ok: true, n: s.length };
      why = 'execCommand copy 被拒绝';
    } finally { try { ta.remove(); } catch (e3) {} }
  } catch (e2) { why = (e2 && e2.message) || String(e2); }
  return { ok: false, error: '剪贴板不可用：' + why };
};

/* 导出单一入口：全库导出统一走 BF.exportBlob——
   ① CSV 自动加 BOM（Excel 直接双击打开 UTF-8 CSV 会乱码，
     BOM EF BB BF 让 Excel 按 UTF-8 解码）；
   ② 换行转义：csvField 按 RFC 4180 规范处理字段内逗号/双引号/换行
     （含换行的字段用双引号包裹、内部双引号倍增，字段内换行
     不再截断 CSV 记录）；
   ③ Blob 构造与下载统一走 BF.download（保存选择器优先、
     a[download] 降级），不散落 new Blob + 手动 a.click() 的
     自实现，一律并入这里。
   opts: { mime, csv } —— csv:true 或 mime 含 csv 时自动加 BOM。 */
BF.exportBlob = function (filename, content, opts) {
  opts = opts || {};
  const mime = opts.mime || 'text/plain;charset=utf-8';
  const isCsv = !!opts.csv || mime.indexOf('csv') >= 0;
  let body = content;
  if (typeof body !== 'string' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    body = String(body == null ? '' : body);
  }
  if (typeof body === 'string' && isCsv) body = '﻿' + body;   /* M-03：CSV 自动加 BOM */
  const blob = new Blob([body], { type: mime });
  return BF.download(filename, blob);
};
/* CSV 字段转义（RFC 4180）：含逗号/双引号/换行的字段用双引号包裹、
   内部双引号倍增。换行经此转义后可安全嵌入字段（否则会截断记录）。 */
BF.exportBlob.csvField = function (v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   /* 中和公式注入：以 = + - @ 开头的字段在表格软件里会被当公式执行，前缀单引号 neutral 化 */
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
/* TSV 字段转义（Anki 文本导入约定，C6/M-04）：制表符分隔的
   字段内不允许裸 tab（会错列）与裸换行（会截断记录）——
   tab 转空格、换行转 <br/>（Anki 字段可渲染 HTML，直接
   吃进不破结构）。与 csvField 分工：csvField 管逗号分隔，
   tsvField 管制表符分隔。无表头行约定：导出方按数据行
   直接拼接，Anki「导入 → 制表符分隔文本」逐行映射两列。 */
BF.exportBlob.tsvField = function (v) {
  /* 字段先按 HTML 转义，再把换行换成 <br/>：Anki 把导入字段按 HTML 渲染，
     正文里的 <img src=x onerror=…> 会直接在收件人的卡片里执行 —— 排版标记只留
     我们自己写的这一个。制表符仍转空格（裸 tab 会错列）。
     公式前缀与 csvField 同一判据：这份文件常被人顺手拖进表格软件。 */
  const s0 = String(v == null ? '' : v);
  let s = BF.dom.esc(s0).replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, '<br/>');
  if (/^[=+\-@\r]/.test(s)) s = "'" + s;
  return s;
};

BF.library.downloadBook = async function (id) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === id);
  if (!b) return;
  /* 「正在导出」只是一句过程话，不进通知历史：
     它没有终态可追（成功／取消／失败各自另有回执），留在历史里就是永久的僵尸条目。 */
  BF.noti.info('正在导出《' + b.title + '》...', { silent: true });
  try {
    const titles = await BF.library.getChapterTitles(id);
    let text = '';
    let _miss = 0;
    for (let i = 0; i < (b.totalChapters || 0); i++) {
      const title = (titles && titles[i]) || '第' + (i + 1) + '章';
      const r = await BF.library.exportChapterText(b, i, title);
      if (!r.ok) _miss++;
      text += title + '\n\n' + r.text + '\n\n';
    }
    const _ok = await BF.exportBlob(b.title + '.txt', text, { mime: 'text/plain;charset=utf-8' });
    /* 按 exportBlob 返回值门控：用户取消
       保存选择器时 BF.download 返回 false（AbortError
       静默），此时不得弹「已导出」。 */
    if (_ok && _miss) BF.noti.warn('已导出《' + b.title + '》，但有 ' + _miss + ' 章正文没读到（文件里只有章名）');
    else if (_ok) BF.noti.success('已导出《' + b.title + '》');
  } catch (e) { BF.err.report('downloadBook', e); BF.noti.error('导出失败'); }
};

/* ============================================================
   北风 · library 域增强：导入进度 / 拖拽 / 剪贴板 / URL / 标签
   （缺失的 3 项新增导入通道）
   ============================================================ */

