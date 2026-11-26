/* ================= A5. 研读 8 卡 ================= */
/* 提示词预设可编辑：默认值 + 自定义覆盖（存 LS）+ 编辑 API。
   调用点 prompt(BF.ai.prompts.xxx) 维持原样，改的是底层对象而非接口。 */
BF.ai._promptDefaults = {
  askBook: '你是《{{book}}》的阅读助手。请根据已读内容回答问题。回答要简洁、有依据；涉及情节时标注【出自第X章】。若未读过相关部分，明确说明"这部分我还没读到"。不要剧透未读章节的情节。',
  summaryChapter: '请用{{level}}字数总结《{{book}}》第{{chapter}}章：主要情节、关键人物、伏笔。输出纯文本，不要列表。',
  summaryBook: '请用{{level}}字数总结《{{book}}》全书：主线、主题，值得一读的理由。',
  characters: '列出《{{book}}》中已出现的主要角色档案，输出 JSON 数组：[{"name":"角色名","role":"身份","traits":"性格特点","arc":"成长线"}]。只基于已读内容。',
  emotionCurve: '根据《{{book}}》已读章节，输出情感曲线 JSON 数组（每章一个点）：[{"chapter":章号,"emotion":"喜/怒/哀/乐/平静/紧张/悬疑/温馨","intensity":1-10,"note":"简短说明"}]。',
  quiz: '根据《{{book}}》以下内容出 5 道阅读理解题，输出 JSON 数组：[{"q":"题目","opts":["A. …","B. …","C. …","D. …"],"ans":"A","why":"解析"}]：\n\n{{content}}',
  recommend: '根据我读过的书推荐 3 本风格相近的书，输出 JSON 数组：[{"title":"书名","reason":"推荐理由"}]。读过的书：{{books}}',
  explain: '用通俗语言解释这段文字的含义、背景与可能的暗示（200 字内）：\n\n{{content}}',
  aiSplit: '你在给一本书重新分章。只输出 JSON 数组，不要任何解释句，也不要重写正文——正文由本地按你给的依据切分。' +
    '每个元素＝一章：{"title":"章节标题","marker":"该章开头在原文里能逐字找到的前 8 到 30 个字"}。' +
    '规则：①marker 必须原样摘自原文（标点、空格、换行都不要改），否则定位不到、那一章就会被跳过；' +
    '②第一章的 marker 就是正文最开头那段；③只在真正的情节/场景转换处切，别在对话中间切；' +
    '④也可以用偏移形式：{"title":"…","start":数字,"end":数字}，此时区间必须首尾相接并一直覆盖到全文结尾，中间留洞会被整体拒绝；' +
    '⑤文本若被截断，只切到你看到的部分。' +
    '书名：{{book}}；当前章数：{{count}}；正文：\n\n{{content}}',
  aiTag: '根据书名和开头，用逗号分隔列出 3-5 个主题标签，只输出标签本身，例如：权谋,成长,悬疑。书名：{{book}}\n\n{{content}}',
  aiGather: '你是书架聚会的助手。下面给你 {{count}} 本书的清单（id、书名、作者、已有标签、摘要）。' +
    '请按内容气质把它们聚成 2-6 组，每组 2 本以上；一本书可以同时进多个组。' +
    '组名要具体、能一眼看出主题（例：氛围相近短篇 / 硬核推理 / 慢热长篇），别用「其他」「杂项」这种兜底名。' +
    '用户的需求：{{hint}}。' +
    '只按清单里给的信息聚，不要编造内容；成员一律用清单里的 id 原样返回，id 不存在会被整体丢弃。' +
    '返回 JSON：{"groups":[{"name":"组名","bookIds":["id1","id2"],"why":"一句话理由"}]}\n\n清单：{{books}}',
};
BF.ai._promptCustom = (function () { try { return BF.store.lsGet(BF.store.K.AI_PROMPTS, {}) || {}; } catch (e) { return {}; } })();
BF.ai.prompts = Object.assign({}, BF.ai._promptDefaults, BF.ai._promptCustom);
/* 契约升级后的存量旧文案不能继续生效：分章提示词从「模型搬运正文」改成
   「只给切分依据」，而历史 AI_PROMPTS 里存的还是旧那份要求输出整段正文的文案，
   定制优先 ⇒ 只换默认值不生效。按旧契约的签名串识别并丢弃这一条，
   真正的用户自写文案（不含该签名）原样保留。 */
if (BF.ai.prompts.aiSplit && BF.ai.prompts.aiSplit.indexOf('"content":"该章正文"') >= 0) {
  BF.ai.prompts.aiSplit = BF.ai._promptDefaults.aiSplit;
  delete BF.ai._promptCustom.aiSplit;
  try { BF.log.info('AI 分章提示词已换用新版契约（旧版要求模型返回整段正文，会把正文改丢）'); } catch (e) {}
}
BF.ai._saveCustomPrompts = function () {
  var c = {};
  for (var k in BF.ai.prompts) { if (BF.ai.prompts[k] !== BF.ai._promptDefaults[k]) c[k] = BF.ai.prompts[k]; }
  try { BF.store.lsSet(BF.store.K.AI_PROMPTS, c); } catch (e) { BF.err.report('ai.savePrompts', e); }
};
BF.ai.setPrompt = function (name, val) { BF.ai.prompts[name] = val; BF.ai._saveCustomPrompts(); };
BF.ai.resetPrompt = function (name) {
  /* 重置前快照被清掉的自定义值——单项只快照那一个键，
     全部重置快照所有与默认不同的键。什么都没改过就是空操作，
     不登记撤销（没有可撤的东西，也不弹一条假吐司）。 */
  const before = {};
  if (name) { if (BF.ai.prompts[name] !== BF.ai._promptDefaults[name]) before[name] = BF.ai.prompts[name]; }
  else { for (const k in BF.ai.prompts) { if (BF.ai.prompts[k] !== BF.ai._promptDefaults[k]) before[k] = BF.ai.prompts[k]; } }
  if (!Object.keys(before).length) return;
  BF.act.run(name ? '恢复默认提示词' : '恢复全部默认提示词', function () {
    if (name) { BF.ai.prompts[name] = BF.ai._promptDefaults[name]; }
    else { BF.ai.prompts = Object.assign({}, BF.ai._promptDefaults); }
    BF.ai._saveCustomPrompts();
  }, {
    undo: function () {
      for (const k in before) BF.ai.prompts[k] = before[k];
      BF.ai._saveCustomPrompts();
      try { if (BF.sheet && BF.sheet.rerender) BF.sheet.rerender('ai-prompts-panel'); } catch (e) {}
    },
  });
};
BF.ai.promptKeys = function () { return Object.keys(BF.ai._promptDefaults); };
BF.ai.PROMPT_LABELS = { askBook: '问书', summaryChapter: '章节摘要', summaryBook: '全书摘要', characters: '角色档案', emotionCurve: '情感曲线', quiz: '随堂小测', recommend: '跨书推荐', explain: '段落解析', aiSplit: 'AI 分章', aiTag: 'AI 主题标签', aiGather: 'AI 聚会' };
/* 卡 id → 提示词键的唯一映射，runCard 的无密钥降级同样只读这张表
   （降级标签必须按提示词键查 PROMPT_LABELS，拿 cardId 去查永远查不中、恒落回英文卡名）。
   Agent 模式有意不在表内：它的提示词就是 [[tool:]] 工具协议本体，
   与解析器配对，不属于预设可编辑集。 */
BF.ai.CARD_PROMPT_KEYS = { ask: 'askBook', 'summary-chapter': 'summaryChapter', 'summary-book': 'summaryBook', characters: 'characters', emotion: 'emotionCurve', quiz: 'quiz', recommend: 'recommend', explain: 'explain', gather: 'aiGather' };
BF.ai.promptEditor = (function () {
  var LABELS = BF.ai.PROMPT_LABELS;
  function open(focusKey) {
    var _fk = focusKey || null;
    var el = document.getElementById('ai-prompts-panel');
    if (!el) {
      /* 骨架统一由 BF._panel 工厂生成（customHTML
         形态——含页脚按钮；头部与页脚两处关闭按钮
         均带 data-panel-close 走文档级委托，页脚
         「关闭」不是死控件）。 */
      BF._panel('ai-prompts-panel', '提示词预设', {
        cls: 'dlg-shell', cssText: '--dlg-top:6vh;--dlg-maxh:88vh;--dlg-of:auto',   /* 提示词预设：整壳自滚，不用内层 body 滚 */
        html: '<header class="pk-panel__head"><span class="pk-panel__title">提示词预设</span><div class="pk-panel__actions"><button class="pk-panel__close" data-prompt-close data-panel-close aria-label="关闭">' + BF.dom.ICON_CLOSE + '</button></div></header>' +
          '<div class="pk-panel__body" id="ai-prompts-body" style="padding:var(--sp-4)"></div>' +
          '<footer class="pk-panel__foot"><button class="btn btn-sm primary" data-prompt-save>保存</button><button class="btn btn-sm" data-prompt-reset-all>恢复全部默认</button><span class="topbar-spacer"></span><button class="btn btn-sm" data-prompt-close data-panel-close>关闭</button></footer>',
      });
      el = document.getElementById('ai-prompts-panel');
      el.querySelector('[data-prompt-save]').addEventListener('click', function () {
        el.querySelectorAll('[data-prompt-key]').forEach(function (ta) {
          var k = ta.getAttribute('data-prompt-key');
          BF.ai.setPrompt(k, ta.value);
        });
        BF.noti.success('提示词已保存');
        BF.sheet.close('ai-prompts-panel');
      });
      el.querySelector('[data-prompt-reset-all]').addEventListener('click', function () {
        BF.ask.confirm({ title: '恢复默认', body: '将清除所有自定义提示词，恢复内置默认值？', confirmText: '恢复', danger: 2, op: 'ai.resetPrompts' })
          /* 成功反馈由撤销通道自带（「恢复全部默认提示词
             （Ctrl+Z 可撤销）」吐司带撤销按钮）——这里再弹一张
             就是同一动作两张卡。 */
          .then(function (ok) { if (ok) { BF.ai.resetPrompt(); render(); } });
      });
    }
    BF.sheet.open('ai-prompts-panel', { render: render });
    render();
    /* 从卡片上的「提示词：X」进来时滚到那一条并描一圈（AI 卡片与提示词的对应关系要看得见） */
    if (_fk) {
      const ta = document.querySelector('[data-prompt-key="' + _fk + '"]');
      if (ta) {
        ta.scrollIntoView({ block: 'center' });
        ta.classList.add('is-prompt-focus');
        BF.timers.timeout(function () { ta.classList.remove('is-prompt-focus'); }, 2200);
        try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
      }
    }
  }
  function render() {
    var body = document.getElementById('ai-prompts-body');
    if (!body) return;
    body.innerHTML = BF.ai.promptKeys().map(function (k) {
      return '<div style="margin-bottom:12px"><label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px">' + (LABELS[k] || k) + ' <code style="opacity:.6">' + k + '</code></label>' +
        '<textarea data-prompt-key="' + k + '" class="input" style="width:100%;min-height:64px;font-size:12px;line-height:1.5">' + BF.dom.esc(BF.ai.prompts[k] || '') + '</textarea>' +
        (BF.ai.prompts[k] !== BF.ai._promptDefaults[k] ? '<button class="btn btn-xs" data-prompt-reset="' + k + '" style="margin-top:4px">恢复此项默认</button>' : '') + '</div>';
    }).join('') +
      '<p style="font-size:12px;color:var(--text-weak);line-height:1.6">提示词支持占位符：<code>{{book}}</code> 书名、<code>{{chapter}}</code> 章号、<code>{{level}}</code> 字数、<code>{{content}}</code> 选中/章节文本、<code>{{books}}</code> 已读书单。</p>';
    body.querySelectorAll('[data-prompt-reset]').forEach(function (btn) {
      btn.addEventListener('click', function () { BF.ai.resetPrompt(btn.getAttribute('data-prompt-reset')); render(); });
    });
  }
  return { open: open, render: render };
})();

