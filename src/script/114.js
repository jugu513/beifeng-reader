/* ================= AI 智能路由层 =================
   用途：模型/provider/编码 等「自动选择」点的历史成功率路由。
   - override(key, choice)：用户手选 = 锁定（写 smartOverrides）
   - unlock(key)：恢复智能（删覆盖）
   - record(key, chosen, result)：记历史（成功/失败/耗时，最多 20 条）
   - route(key, candidates)：按 用户锁定 → 历史成功率加成 → 评分 选最优
   存储：bf_smart_history / bf_smart_overrides（独立键，不占 settings）
   北风从移植，裁剪掉 captureLog 依赖（北风用 BF.log），
   并补「无候选回退」「历史为空走初始评分」的兜底语义。 */
BF.ai.smart = (function () {
  const HIST_KEY = 'smartHistory';
  const OV_KEY = 'smartOverrides';
  function _hist() { try { return BF.store.lsGet(HIST_KEY, {}) || {}; } catch (e) { return {}; } }
  function _saveHist(h) { try { BF.store.lsSet(HIST_KEY, h); } catch (e) { BF.err.report('smart.histWrite', e); } }
  function _ov() { try { return BF.store.lsGet(OV_KEY, {}) || {}; } catch (e) { return {}; } }
  function _saveOv(o) { try { BF.store.lsSet(OV_KEY, o); } catch (e) { BF.err.report('smart.overrideWrite', e); } }
  function isLocked(key) { const o = _ov(); return Object.prototype.hasOwnProperty.call(o, key); }
  function override(key, choice) {
    try {
      const o = _ov(); o[key] = choice; _saveOv(o);
      try { BF.log && BF.log.info('自动选择：用户锁定 ' + key + '=' + choice); } catch (e) {}
    } catch (e) {}
  }
  function unlock(key) {
    try {
      const o = _ov();
      if (Object.prototype.hasOwnProperty.call(o, key)) { delete o[key]; _saveOv(o); }
      try { BF.log && BF.log.info('自动选择：恢复自动 ' + key); } catch (e) {}
    } catch (e) {}
  }
  function unlockAll() { try { _saveOv({}); } catch (e) {} }
  function record(key, chosen, result) {
    try {
      const h = _hist();
      const arr = h[key] = h[key] || [];
      arr.push({ chosen: String(chosen), ok: !!(result && result.ok), ms: (result && result.ms) || 0, t: Date.now() });
      if (arr.length > 20) arr.splice(0, arr.length - 20);
      _saveHist(h);
    } catch (e) {}
  }
  /* candidates: [{id, score}] 或 [{id}]；scorer 可选：现场算分（c, candidates, histScore） */
  function route(key, candidates, scorer) {
    try {
      const o = _ov();
      if (Object.prototype.hasOwnProperty.call(o, key)) return { choice: o[key], source: 'override', score: 1 };
      const h = _hist();
      const hist = h[key] || [];
      const histScore = {};
      hist.forEach(function (r) { if (r.ok) histScore[r.chosen] = (histScore[r.chosen] || 0) + 1; });
      let best = null, bestScore = -Infinity;
      for (const c of (candidates || [])) {
        if (!c || c.id == null) continue;
        let s = typeof scorer === 'function' ? scorer(c, candidates, histScore) : (c.score || 0);
        if (histScore[c.id] != null) s += Math.min(0.3, histScore[c.id] * 0.1);
        if (s > bestScore) { bestScore = s; best = c.id; }
      }
      if (best == null) return { choice: null, source: 'fallback', score: -Infinity };
      return { choice: best, source: 'smart', score: bestScore };
    } catch (e) { return { choice: null, source: 'fallback', score: -Infinity }; }
  }
  return { isLocked: isLocked, override: override, unlock: unlock, unlockAll: unlockAll, record: record, route: route, _histKey: HIST_KEY, _ovKey: OV_KEY };
})();

BF.ai.renderCards = function (container) {
  const cards = [
    { id: 'ask', label: '问书', desc: '就当前书提问' },
    { id: 'summary-chapter', label: '章节摘要', desc: '本章要点' },
    { id: 'summary-book', label: '全书摘要', desc: '整体概览' },
    { id: 'characters', label: '角色档案', desc: '人物梳理' },
    { id: 'emotion', label: '情感曲线', desc: '情绪走势' },
    { id: 'quiz', label: '随堂小测', desc: '阅读理解' },
    { id: 'recommend', label: '跨书推荐', desc: '相似好书' },
    { id: 'explain', label: '段落解析', desc: '选中文字解读' },
    { id: 'gather', label: 'AI 聚会', desc: '按氛围分组（只出建议）' },
    { id: 'agent', label: 'Agent 模式', desc: '可调用本地工具' },
  ];
  if (!container) return cards;
  /* Agent 不是"任务"而是另一种模式：不进卡片网格，走自己的入口按钮 */
  const shown = cards.filter(function (c) { return c && c.id !== 'agent'; });
  container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">' +
    shown.map(function (c) {
      /* 卡片直说它用哪条提示词、有没有被改过（原来这层对应关系全靠用户猜）：
         点这行直接跳到提示词面板并定位那一条 */
      const pk = BF.ai.CARD_PROMPT_KEYS[c.id];
      const custom = pk && BF.ai.prompts[pk] !== BF.ai._promptDefaults[pk];
      return '<div class="ai-card" data-ai-card="' + c.id + '" style="padding:12px;border:1px solid var(--border);border-radius:var(--r-card);cursor:pointer;transition:all .15s">' +
        '<div style="font-weight:600;font-size:13px">' + c.label + '</div>' +
        '<div style="font-size:11px;color:var(--text-weak);margin-top:3px">' + c.desc + '</div>' +
        (pk ? '<button class="btn btn-xs ai-card__prompt" data-prompt-jump="' + BF.dom.escAttr(pk) + '">改提示词' + (custom ? '（已自定义）' : '') + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  return cards;
};

