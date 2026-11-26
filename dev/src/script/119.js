/* ================= A8b. 问书对话导出 =================
   把聊完的结论带走，导出两种格式：
   Markdown（可直接贴进笔记/文档）+ JSON（完整轮次，便于再加工）。
   刻意不读 Key：只导 AI_ASK_SESSIONS 一个键，不走 _snapshot 全量路径。 */
BF.ai.exportAskHistory = async function (bookId, fmt, sid) {
  const bid = bookId || BF.appState.currentBookId;
  if (!bid) { BF.noti.warn('请先打开一本书'); return; }
  const s = sid ? (BF.ai.askSessions(bid).filter(function (x) { return x && x.id === sid; })[0] || null) : BF.ai.askActive(bid);
  const hist = (function () {
    const out = [];
    for (const x of ((s && s.turns) || [])) {
      if (typeof x === 'string') out.push({ role: 'user', content: x });
      else if (x && x.q != null) { out.push({ role: 'user', content: x.q }); if (x.a != null) out.push({ role: 'assistant', content: x.a }); }
    }
    return out;
  })();
  if (!hist.length) { BF.noti.info('当前会话还没有问书记录'); return; }
  const book = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (b) { return b && b.id === bid; });
  const title = (book && book.title) || '未知书籍';
  const sessName = (s && s.title) || '默认会话';
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
  const safeS = sessName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 20);
  const stamp = new Date().toISOString().slice(0, 10);
  const qCount = hist.filter(function (m) { return m.role === 'user'; }).length;

  let payload, name, mime;
  if (fmt === 'json') {
    payload = JSON.stringify({ type: 'ai-ask-history', version: 2, bookId: bid, book: title, session: sessName, sessionId: (s && s.id) || null, exportedAt: Date.now(), turns: hist }, null, 2);
    name = 'AI问书_' + safe + '_' + safeS + '_' + stamp + '.json';
    mime = 'application/json';
  } else {
    const L = ['# 问书记录 · ' + title, '', '> 会话：' + sessName, '> 导出于 ' + new Date().toLocaleString('zh-CN') + ' · 共 ' + qCount + ' 轮问答', ''];
    /* 回答含代码块（```）时必须保证 Markdown 结构完整：内容不能直接拼进段落，
       代码块没换行包裹会破坏整个 md 渲染。 */
    const _mdBlock = function (s) {
      const txt = String(s == null ? '' : s);
      if (!txt) return '';
      /* 已含 ``` 的视为已有代码块，前后补空行确保块边界独立，不重复包裹 */
      if (txt.indexOf('```') >= 0) return '\n\n' + txt + '\n\n';
      /* 多行内容用围栏代码块包裹，单行直接拼 */
      if (txt.indexOf('\n') >= 0) return '\n```\n' + txt + '\n```\n';
      return txt;
    };
    for (let i = 0; i < hist.length; i++) {
      const m = hist[i];
      if (m.role === 'user') L.push('**Q' + (i + 1) + '：** ' + m.content, '');
      else L.push('**A：**', _mdBlock(m.content), '');
    }
    payload = L.join('\n');
    name = 'AI问书_' + safe + '_' + safeS + '_' + stamp + '.md';
    mime = 'text/markdown';
  }
  const _ok = await BF.exportBlob(name, payload, { mime: mime + ';charset=utf-8' });
  /* 按 exportBlob 返回值门控：取消保存选择器不弹成功 */
  if (_ok) BF.noti.success('已导出 ' + qCount + ' 轮问书记录（' + (fmt === 'json' ? 'JSON' : 'Markdown') + '）');
};

