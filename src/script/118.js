/* ================= A8c. 多会话 =================
   每本书按会话组织，避免聊久了上下文混在一起、无法分主题：
   { [bookId]: { sessions: [{id, title, turns:[{q,a}], at}], activeId } }
   兼容：旧数据是数组时，首次读取自动迁移成一个名为「默认会话」的会话，
        不丢任何历史。迁移后写回新格式。 */
BF.ai.askSessions = function (bookId) {
  const bid = bookId || BF.appState.currentBookId;
  if (!bid) return [];
  const all = BF.store.lsGet(BF.store.K.AI_ASK_SESSIONS, {}) || {};
  let entry = all[bid];
  /* 归一化：只认两种形态——扁平数组（迁移）、{sessions,activeId}。
     其余（null / 数字 / 字符串 / 缺 sessions）一律重置为空结构，
     避免调用方拿到半个对象后 TypeError（读历史时会炸）。 */
  if (Array.isArray(entry)) {
    /* 迁移：旧扁平数组 → 单会话 */
    entry = {
      sessions: entry.length ? [{ id: 's_' + Date.now(), title: '默认会话', turns: entry, at: Date.now() }] : [],
      activeId: null,
    };
    if (entry.sessions.length) entry.activeId = entry.sessions[0].id;
    all[bid] = entry;
    try { BF.store.lsSet(BF.store.K.AI_ASK_SESSIONS, all); } catch (e) { BF.err.report('ai.session.saveNew', e); }
    BF.log && BF.log.info('问书历史已迁移为多会话结构：' + bid);
  }
  if (!entry || typeof entry !== 'object') { entry = { sessions: [], activeId: null }; all[bid] = entry; }
  if (!Array.isArray(entry.sessions)) entry.sessions = [];
  /* 清掉数组里的空洞（null / 非对象）与没有 id 的残次项——它们会让下游
     `s.id`、`s.turns` 抛 TypeError，而存储被写坏时这类值确实会出现。 */
  if (entry.sessions.some(function (s) { return !s || typeof s !== 'object' || !s.id; })) {
    entry.sessions = entry.sessions.filter(function (s) { return s && typeof s === 'object' && s.id; });
    if (!Array.isArray(entry.turns)) { /* noop：仅为可读性 */ }
    entry.sessions.forEach(function (s) { if (!Array.isArray(s.turns)) s.turns = []; });
    try { BF.store.lsSet(BF.store.K.AI_ASK_SESSIONS, all); } catch (e) { BF.err.report('ai.session.appendTurn', e); }
  }
  if (!entry.activeId || !entry.sessions.some(function (s) { return s && s.id === entry.activeId; })) {
    entry.activeId = entry.sessions.length ? entry.sessions[entry.sessions.length - 1].id : null;
  }
  return entry.sessions;
};
BF.ai._askEntry = function (bookId) {
  const bid = bookId || BF.appState.currentBookId;
  if (!bid) return { sessions: [], activeId: null };
  BF.ai.askSessions(bid);   /* 触发迁移 + 结构归一 */
  /* 必须**重新读一次**：askSessions 内部可能已重建并写回 entry，
     若直接用调用前的 all[bid] 快照，那份快照可能还是旧结构
     （例如 sessions 字段缺失），调用方一访问 .sessions 就 TypeError。
     lsGet 每次返回新副本，所以这里重读是正确做法。 */
  const all = BF.store.lsGet(BF.store.K.AI_ASK_SESSIONS, {}) || {};
  const e = all[bid];
  if (!e || typeof e !== 'object') return { sessions: [], activeId: null };
  if (!Array.isArray(e.sessions)) e.sessions = [];
  return e;
};
BF.ai._askSave = function (bookId, entry) {
  const all = BF.store.lsGet(BF.store.K.AI_ASK_SESSIONS, {}) || {};
  all[bookId || BF.appState.currentBookId] = entry;
  /* 与同文件 L30218/L30229 同键写入同一口径：写失败必须留痕。
     裸 lsSet 在配额/异常时会抛断调用或静默丢失，界面却以为会话已存，重开即空。 */
  try { BF.store.lsSet(BF.store.K.AI_ASK_SESSIONS, all); } catch (e) { BF.err.report('ai.session.save', e); }
};
BF.ai.askActive = function (bookId) {
  const e = BF.ai._askEntry(bookId);
  const list = Array.isArray(e.sessions) ? e.sessions : [];
  return list.filter(function (s) { return s && s.id === e.activeId; })[0] || null;
};
BF.ai.askActiveSet = function (sid, bookId) {
  const bid = bookId || BF.appState.currentBookId;
  const e = BF.ai._askEntry(bid);
  if ((e.sessions || []).some(function (s) { return s && s.id === sid; })) {
    e.activeId = sid;
    BF.ai._askSave(bid, e);
  }
  return BF.ai.askActive(bid);
};
BF.ai.askNew = function (title, bookId) {
  const bid = bookId || BF.appState.currentBookId;
  if (!bid) return null;
  const e = BF.ai._askEntry(bid);
  if (!Array.isArray(e.sessions)) e.sessions = [];
  const s = { id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: title || ('新会话 ' + (e.sessions.length + 1)), turns: [], at: Date.now() };
  e.sessions.push(s);
  e.activeId = s.id;
  BF.ai._askSave(bid, e);
  return s;
};
BF.ai.askRename = function (sid, title, bookId) {
  const e = BF.ai._askEntry(bookId);
  const s = (e.sessions || []).filter(function (x) { return x && x.id === sid; })[0];
  if (!s) return false;
  s.title = String(title || '').slice(0, 40) || s.title;
  BF.ai._askSave(bookId, e);
  return true;
};
BF.ai.askDel = async function (sid, bookId) {
  const bid = bookId || BF.appState.currentBookId;
  const e = BF.ai._askEntry(bid);
  const i = (e.sessions || []).findIndex(function (x) { return x && x.id === sid; });
  if (i < 0) return false;
  const s = e.sessions[i];
  /* 确认绑在能力上：会话条数在这里本来就拿得到，不必挂在入口侧拼文案；
     AI 面板按钮 / hub / DSL 任何入口调 askDel 都必须先过确认。
     删完登记进撤销通道——会话对象与插入位都握在手里，
     撤销即原样插回并恢复 activeId。 */
  const ok = await BF.ask.confirm({
    title: '删除会话',
    body: '确定删除会话「' + BF.dom.esc((s && s.title) || '（未命名）') + '」？<br/>其中的 ' +
      (((s && s.turns) || []).length) + ' 条记录将一并删除。',
    confirmText: '删除', danger: 2, op: 'ai.session.delete', facts: {},
  });
  if (!ok) return false;
  const prevActive = e.activeId;
  BF.act.run('删除会话', function () {
    e.sessions.splice(i, 1);
    if (e.activeId === sid) e.activeId = e.sessions.length ? e.sessions[Math.max(0, i - 1)].id : null;
    BF.ai._askSave(bid, e);
  }, {
    /* 会话按书归档（_askSave(bid, …)）⇒ 归属记在会话所属的书上，不是当前开着的书 */
    bookId: bid,
    undo: function () {
      e.sessions.splice(Math.min(i, e.sessions.length), 0, s);
      e.activeId = prevActive;
      BF.ai._askSave(bid, e);
      try { if (BF.sheet && BF.sheet.rerender) BF.sheet.rerender('ai-center'); } catch (e2) {}
    },
  });
  return true;
};

/* 判断会话名是否还是自动生成的（尚未被用户手动命名）。
   只有这种会话才允许被「首轮提问自动取名」覆盖，用户手动起的名要保住。 */
BF.ai._isAutoTitle = function (title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return true;
  return t === '默认会话' || /^新会话\s*\d+$/.test(t);
};

BF.ai.askHistory = function (bookId) {
  /* 历史条目兼容：字符串数组是原始提问；成对对象 {q,a} 展开为 user/assistant 轮次 */
  const s = BF.ai.askActive(bookId);
  const h = (s && Array.isArray(s.turns)) ? s.turns : [];
  const out = [];
  for (const x of h) {
    if (typeof x === 'string') { out.push({ role: 'user', content: x }); }
    else if (x && x.q != null) {
      out.push({ role: 'user', content: x.q });
      if (x.a != null) out.push({ role: 'assistant', content: x.a });
    }
  }
  return out;
};
BF.ai.askHistoryPush = function (bookId, q, a) {
  try {
    const bid = bookId || BF.appState.currentBookId;
    if (!bid) return;
    let e = BF.ai._askEntry(bid);
    let s = (e.sessions || []).filter(function (x) { return x && x.id === e.activeId; })[0];
    /* 没有活动会话就自动开一个，避免历史丢失。
       注意：askNew 内部会重新读一次存储并写回，所以这里必须把 e 重新读一遍——
       否则下面 _askSave 写回的是旧对象，会把刚建的会话整个抹掉（历史静默丢失）。 */
    if (!s) {
      s = BF.ai.askNew('默认会话', bid);
      if (!s) return;
      e = BF.ai._askEntry(bid);
      s = (e.sessions || []).filter(function (x) { return x && x.id === s.id; })[0] || s;
    }
    if (!s) return;
    const last = s.turns[s.turns.length - 1];
    if (last && typeof last === 'object' && last.q === q && a == null) return;
    s.turns.push(a != null ? { q: q, a: a } : { q: q });
    /* 单会话内保留最近 40 轮，超出丢弃最早的 */
    if (s.turns.length > 40) s.turns.shift();
    /* 首轮提问自动取会话名，方便在列表里认。
       但只在会话名还是自动生成的（默认会话 / 新会话 N）时才取，
       否则会把用户手动起的名覆盖掉。 */
    if (s.turns.length === 1 && BF.ai._isAutoTitle(s.title)) s.title = String(q).replace(/\s+/g, ' ').slice(0, 18);
    s.at = Date.now();
    BF.ai._askSave(bid, e);
  } catch (e) { BF.err.report('askHistoryPush', e); }
};

