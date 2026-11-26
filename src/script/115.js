/* ================= A6. 卡片执行 ================= */
/* 多章取材：拼接最近 n 章正文（每章截取 perChapter 字），供角色/情感等卡跨章分析 */
BF.ai._recentChapters = async function (b, n, perChapter) {
  if (!b) return '';
  const total = b.totalChapters || 0;
  const cur = BF.appState.currentChapterIdx || 0;
  /* 防剧透限界：旧版固定取全书最后 n 章——角色档案/情感曲线标着「已读章节」，
     实际喂的是结局。防剧透开启时只取「当前进度往前 n 章」；关闭时维持旧取材，
     但每段都带已读/未读属性，模型与用户都看得出出处状态（#151）。 */
  const capped = BF.settings.get('aiRefBook') !== false;
  const end = capped ? Math.min(total, cur + 1) : total;
  const start = Math.max(0, end - n);
  /* 一批并发取章（结果按章序入位，join 顺序与逐章串读逐字一致；
     只并 I/O，不碰任何取材语义） */
  const idxs = [];
  for (let i = start; i < end; i++) idxs.push(i);
  const texts = await Promise.all(idxs.map(function (i) {
    return BF.library.getChapterText(b, i).then(function (t) { return t; }, function () { return ''; });
  }));
  const parts = [];
  texts.forEach(function (t, k) {
    if (t) parts.push('【第' + (idxs[k] + 1) + '章·' + (idxs[k] <= cur ? '已读' : '未读') + '】\n' + String(t).slice(0, perChapter));
  });
  if (capped && end < total) parts.push('【page_limit】以上为第1~' + end + '章的已读内容；后续章节未读，不得据此作答。');
  return parts.join('\n\n');
};
/* 并发中断句柄管理：_abortCtrl 是全局单例（停止按钮按它），
   但并发两个请求时旧请求结束不能把新请求的句柄误清。
   _setAbort 记录当前句柄；_clearAbort 只在句柄仍是自己时才清空。 */
BF.ai._abortSeq = 0;
/* C11 标注喂 AI：标注出处上下文暂存。标注中心「问 AI」
   写入（书/章/原文引用/定位锚），问书发送时随 user
   消息注入取材、回答完成后清空——一次性注入语义。 */
BF.ai._annCtx = null;
BF.ai._setAbort = function (ac) {
  BF.ai._abortSeq++;
  ac._bfSeq = BF.ai._abortSeq;
  BF.ai._abortCtrl = ac;
  return ac;
};
BF.ai._clearAbort = function (ac) {
  if (!ac) { BF.ai._abortCtrl = null; return; }
  /* 句柄已被更新的请求接管时不动（并发保护） */
  if (BF.ai._abortCtrl === ac || (BF.ai._abortCtrl && BF.ai._abortCtrl._bfSeq === ac._bfSeq)) BF.ai._abortCtrl = null;
};
BF.ai.runCard = async function (cardId, opts) {
  opts = opts || {};
  const b = BF.reader.state.book;
  const bookName = (b && b.title) || '当前书';
  if (!BF.ai.requireKey('AI 研读')) {
    /* 无密钥降级：复制提示词到剪贴板，不静默跳过 */
    try {
      /* 映射与标签都读登记表（见 BF.ai.CARD_PROMPT_KEYS 处说明）；
         agent 卡无注册键 → 只复制【Agent 模式】+ 取材正文，不静默空复制。 */
      const _pk = opts.promptKey || BF.ai.CARD_PROMPT_KEYS[cardId];
      const _p = _pk && BF.ai.prompts ? BF.ai.prompts[_pk] : '';
      const _lab = BF.ai.PROMPT_LABELS[_pk] || (BF.ai.renderCards(null).filter(function (c) { return c.id === cardId; })[0] || {}).label || cardId;
      await BF.ai.fallbackCopy({ prompt: _p, content: opts.content }, _lab);
    } catch (e) {}
    return null;
  }
  const setResult = opts.setResult || function () {};
  let cacheKey = opts.cacheKey || null;
  /* 未显式传 cacheKey 时，按「卡类型+书+章+sid」自动生成，实现按书/章/sid 失效。
     sid 取 BF.reader.currentSid()（= stableSid(标题, 正文)，重分章后同内容 sid 稳定、
     不同内容 sid 必变）——重分章导致「章号」语义漂移时，旧章摘要不会错贴到新章。 */
  if (!cacheKey && b && ['summary-chapter', 'characters', 'emotion', 'quiz'].includes(cardId)) {
    let _sid = '';
    try { _sid = (await BF.reader.currentSid()) || ''; } catch (_) { _sid = ''; }
    /* 摘要长度档变了提示词也变：键里带上档位，否则切档后仍命中旧长度的摘要 */
    cacheKey = cardId + ':' + BF.appState.currentBookId + ':' + BF.appState.currentChapterIdx + ':' + _sid + ':' + (BF.settings.get('aiSummaryLevel') || 'standard');
  }
  if (cacheKey && !opts.force) {
    const hit = BF.ai.sumCache.get(cacheKey);
    if (hit) { setResult(hit); return hit; }
  }
  const level = BF.settings.get('aiSummaryLevel') || 'standard';
  const levelWords = BF.CONFIG.AI_SUMMARY_LEVEL_WORDS[level] || '150';
  const askTurns = Math.max(1, BF.settings.num('aiAskTurns', 6));
  const ctxSegs = Math.max(1, BF.settings.num('aiContextSegs', 4));
  const ctxLen = ctxSegs * BF.CONFIG.AI_CTX_SEG_LEN;
  let msgs = [];
  const prompt = function (s) {
    return s.replace(/\{\{book\}\}/g, bookName)
      .replace(/\{\{chapter\}\}/g, String((BF.appState.currentChapterIdx || 0) + 1))
      .replace(/\{\{level\}\}/g, levelWords)
      .replace(/\{\{content\}\}/g, (opts.content || '').slice(0, 2000))
      .replace(/\{\{books\}\}/g, (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).slice(0, 10).map(x => x.title).join('、'));
  };
  /* 问书/段落解析：无显式内容时，注入当前章节正文作为取材（修复"取材空"） */
  if ((cardId === 'ask' || cardId === 'explain' || cardId === 'agent') && !opts.content && b) {
    try { opts.content = ((await BF.library.getChapterText(b, BF.appState.currentChapterIdx)) || '').slice(0, 3000); } catch (_) {}
  }
  /* 中断句柄必须在 switch 之前建好：Agent 分支自己发请求，不走下面的流式分支。
     _abortCtrl 由 cardRun 持有（停止按钮按它）；为避免并发时旧请求结束把新请求的
     句柄误清（别处 BF.ai._abortCtrl = null 是全局写），统一走 _setAbort()/_clearAbort()：
     只有句柄仍是自己时才清空，别人已接管则不动。 */
  const _ac = new AbortController();
  BF.ai._setAbort(_ac);
  switch (cardId) {
    case 'ask': {
      /* askBook 模板必须含 {{content}} 占位符：缺占位符时前面取出的 3000 字正文进不了请求，
         最终只有书名+问题，模型只能凭书名臆造情节（还被要求标注章节）。 */
      const _ctx = (opts.content || '').slice(0, 2000);
      /* Agent 模式：开启时先全书检索相关章节再作答。
         检索片段一律带「已读/未读」属性（#151 上下文章带该属性）：
         防剧透开启时检索范围本来只到当前进度（见 chunkIdx），不会出现未读块；
         防剧透关闭时未读片段也如实标注，模型与用户都能看出出处状态。 */
      let _rel = '';
      if (BF.settings.get('aiAgent') && b) {
        try {
          const hits = await BF.ai.retrieve(b, opts.question, ctxSegs, { signal: _ac.signal });
          if (hits.length) {
            _rel = '\n【全书相关片段】\n' + hits.map(function (h) {
              return '（第' + (h.idx + 1) + '章·' + (h.read ? '已读' : '未读') + '）' + h.snippet.replace(/\s+/g, ' ').slice(0, 400);
            }).join('\n');
          }
        } catch (_) {}
      }
      /* 提示词增强：关闭时只发原始问题 */
      let _sys = prompt(BF.ai.prompts.askBook);
      /* 防剧透：refBookCtx 与 aiRefBook 开关必须接进请求，否则拨动无效。
         开启时告知当前进度并保留防剧透约束；
         关闭时剥掉模板里的防剧透句并明确允许自由发挥。 */
      const _ref = BF.ai.refBookCtx ? BF.ai.refBookCtx() : '';
      if (BF.settings.get('aiRefBook') === false) {
        _sys = _sys.replace('不要剧透未读章节的情节。', '')
          + '\n\n【模式：自由发挥】可以讨论未读章节的情节。';
      } else if (_ref) {
        _sys += '\n\n' + _ref;
      }
      /* 标注喂 AI——标注出处（书/章/原文引用）随
         问书注入取材，AI 可据此回引出处；出处锚由调用方
         （标注中心「问 AI」）经 opts.ann 传入。 */
      const _annSrc = opts.ann ? (
        '\n\n【标注出处】\n书：《' + bookName + '》\n章节：第' + ((opts.ann.chapterIdx || 0) + 1) + '章\n原文引用：「' + String(opts.ann.text || '').slice(0, 200) + '」') : '';
      _sys += (BF.settings.get('aiPromptMode') === false ? '' :
        '\n\n回答要求：1) 只依据提供的原文作答，原文未涉及的内容明确说明；2) 引用关键原句并标注出自第几章；3) 分点陈述，控制在 300 字以内。');
      /* 无可读内容给占位文本而不是留空（#151）：空章 / 正文读取失败 / 未开书时，
         请求里若只有一句问题，模型只能凭书名臆造情节。占位文本明确告知
         「现在读不到正文」，把臆造空间收掉。 */
      const _noContent = (_ctx || _rel || _annSrc) ? '' :
        '\n\n【当前无可读正文】这一问没有取到任何可读内容（空章、正文读取失败或尚未打开书）。若回答依赖原文，请如实说明现在读不到正文，不要凭书名臆造情节。';
      msgs = [
        { role: 'system', content: _sys },
        ...(opts.history || []).slice(-askTurns),
        { role: 'user', content: (_ctx ? '【当前章节已读内容】\n' + _ctx + '\n\n' : '') + (_rel ? _rel + '\n\n' : '') + (_annSrc ? _annSrc + '\n\n' : '') + _noContent + '【我的问题】\n' + (opts.question || '') },
      ];
      break;
    }
    case 'summary-chapter': {
      const text = await BF.library.getChapterText(b, BF.appState.currentChapterIdx);
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.summaryChapter) + '\n\n章节内容：\n' + String(text).slice(0, ctxLen) }];
      break;
    }
    case 'summary-book': {
      const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
      const myBook = books.find(x => x && x.id === BF.appState.currentBookId);
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.summaryBook) + '\n\n书名：' + bookName + '（共' + ((myBook && myBook.totalChapters) || '?') + '章）' }];
      break;
    }
    case 'characters': {
      const text = await BF.ai._recentChapters(b, 3, 2500);
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.characters) + '\n\n已读章节内容摘录：\n' + text }];
      break;
    }
    case 'emotion': {
      const text = await BF.ai._recentChapters(b, 6, 1100);
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.emotionCurve) + '\n\n已读章节内容摘录：\n' + text }];
      break;
    }
    case 'quiz': {
      const text = await BF.library.getChapterText(b, BF.appState.currentChapterIdx);
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.quiz) + '\n\n' + String(text).slice(0, ctxLen) }];
      break;
    }
    case 'recommend':
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.recommend) }];
      break;
    case 'explain':
      msgs = [{ role: 'user', content: prompt(BF.ai.prompts.explain) }];
      break;
    case 'agent': {
      /* Agent 模式：独立卡片，模型按 [[tool:名称:参数]] 协议调用本地工具。
         工具在 BF.ai.tools 白名单内，越界/异常一律忽略并让模型继续，
         最多 3 轮工具循环，避免无限调用。 */
      if (!opts.question) { BF.ai._clearAbort(_ac); return null; }
      const _tools = (BF.ai.AGENT_TOOLS || Object.keys(BF.ai.tools)).slice();
      const _adviceKeys = Object.keys(BF.ai.SETTING_ADVICE || {}).join('、');
      msgs = [
        { role: 'system', content:
            '你是《' + bookName + '》的阅读助手，同时可以调用本地工具协助。' +
            '需要工具时，只输出 [[tool:工具名:参数]] 这一段（一次一个），例如 [[tool:searchBook:林冲]]。' +
            '可用工具：' + _tools.join('、') + '。拿到工具结果后继续回答用户问题，最终用中文给出完整答复。\n' +
            '若用户抱怨排版、字号、主题、语速等阅读体验，你可以用 adviseSettings 提出设置建议：' +
            '格式为 [[tool:adviseSettings:键=值]]，多个用分号分隔（如 fontSize=20;lineHeight=2.2）。' +
            '可建议的键有：' + _adviceKeys + '。' +
            '注意：这只是建议，会弹窗让用户勾选授权，用户可能全部拒绝。' +
            '所以在收到工具结果确认「已应用」之前，回答里绝不能说「已帮你改好设置」。'},
        { role: 'user', content: (opts.content ? '【当前章节已读内容】\n' + String(opts.content).slice(0, 2000) + '\n\n' : '') + '【我的问题】\n' + String(opts.question) },
      ];
      try {
        /* 系统提示词统一走 BF.ai.agentSystemPrompt：面板与终端不再各存一份 */
        msgs[0] = { role: 'system', content: BF.ai.agentSystemPrompt(bookName) };
        const _ans = await BF.ai.agentRun(msgs, { setResult: setResult, signal: _ac.signal });
        if (_ans) { setResult(_ans); return _ans; }
        return '';
      } catch (e) { BF.ai._clearAbort(_ac); throw e; }
    }
    default:
      return null;
  }
  let _acc = '';
  try {
    const out = await BF.ai.gateway.call(msgs, {
      stream: true,
      signal: _ac.signal,
      onDelta: function (d) {
        /* 推理内容（DeepSeek-R1 / K2 这类）单独走一条通道，界面把它收进折叠块 */
        if (d.type === 'reasoning') { if (opts.onReasoning) { try { opts.onReasoning(d.text); } catch (e) {} } return; }
        if (d.type === 'content') { _acc += d.text; try { setResult(_acc, true); } catch (e) {} }
      },
    });
    /* 流式累积：onDelta 期间外层 out 尚未赋值，必须在本地累加后再回传，否则实时显示永远为空 */
    if (!_acc && out && out.content) _acc = out.content;
    if (_acc) {
      setResult(_acc);
      if (cacheKey && !opts.force) BF.ai.sumCache.set(cacheKey, _acc);
      /* 读者侧 AI 摘要（章节/全书）生成后回写书 meta.summary，沉淀到本书（与导入增强共用字段） */
      if (cardId === 'summary-chapter' || cardId === 'summary-book') {
        try {
          const _bid = BF.appState.currentBookId;
          if (_bid) {
            /* 摘要写回走 mutate。_acc 与 _bid 均为入参/局部量，回调内不读外部状态。 */
            const _sum = String(_acc).slice(0, 600);
            BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
              arr = arr || [];
              const _b = arr.find(function (x) { return x && x.id === _bid; });
              if (!_b) return false;
              _b.summary = _sum;
              return arr;
            }).then(function (ok) {
              if (ok === false) return;
              try { BF.app.renderBookshelf(); BF.app.renderHome(); } catch (e) { BF.err.report('render.afterSummarySave', e); }
              BF.noti.success('AI 摘要已保存到本书信息');
            });
          }
        } catch (e) { BF.err.report('ai.summary.meta', e); }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      /* 用户主动停止：保留已生成内容，不再抛错 */
      if (_acc) setResult(_acc);   /* 半截内容留给人看，但不进摘要缓存 —— 下次会被当成完整摘要复用 */
      BF.ai._clearAbort(_ac);
      return _acc;
    }
    BF.ai._clearAbort(_ac);
    throw e;
  }
  BF.ai._clearAbort(_ac);
  return _acc;
};

