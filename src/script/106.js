/* ================= 结构化返回（tools 优先 → json_object → 纯文本兜底） =================
   为什么在网关外面包一层而不是改 call：`opts.body` 已经能把任意字段并进请求体，
   返回侧 `out.raw` 又留着完整 JSON，所以 tool_calls 直接就读得到 ——
   少动一处 call 的分支，就少一处能把所有 AI 功能一起弄坏的地方。
   档由 BF.net.toolsMode() 决定（auto 探测 + 可手动锁）：
     tools → 函数调用；plain → 只要 JSON 模式；探测不过一律按纯文本兜底，
     且**兜底必须说出来**——"模型未按结构返回"是一句能被听懂的话，
     静默把残缺结果当成功不是。 */
BF.ai.STRUCT_TOOL = 'bf_result';
BF.ai.structured = async function (messages, schema, opts) {
  opts = opts || {};
  const mode = BF.net.toolsMode();
  const body = {};
  if (mode === 'tools') {
    body.tools = [{
      type: 'function',
      function: { name: BF.ai.STRUCT_TOOL, description: opts.desc || '按 schema 返回结果', parameters: schema },
    }];
    body.tool_choice = 'auto';
  } else if (mode === 'plain') {
    body.response_format = { type: 'json_object' };
  }
  const out = await BF.ai.gateway.call(messages, { stream: false, body: body, signal: opts.signal });
  const msg = out && out.raw && out.raw.choices && out.raw.choices[0] && out.raw.choices[0].message;
  const call = msg && msg.tool_calls && msg.tool_calls[0];
  const payload = call && call.function ? call.function.arguments : (out && out.content) || '';
  const parsed = BF.ai.parseJson(payload);
  if (parsed === null && mode === 'tools') {
    /* 服务商收了 tools 却没回函数调用（模型不支持 / 网关吞字段）：
       降级重发一次纯文本形态，而不是把空结果当成功 */
    BF.log.info('AI 结构化：tools 档未返回函数调用，降级 JSON 文本重发一次');
    const out2 = await BF.ai.gateway.call(messages, { stream: false, body: { response_format: { type: 'json_object' } }, signal: opts.signal });
    const p2 = BF.ai.parseJson(out2 && out2.content);
    if (p2 !== null) return p2;
    throw new Error('模型未按结构返回（试过函数调用与 JSON 模式）：' + String((out2 && out2.content) || '').slice(0, 80));
  }
  if (parsed === null) throw new Error('模型未按结构返回：' + String(payload || '').slice(0, 80));
  return parsed;
};
/* 从模型文本里抠出 JSON：剥 ``` 围栏、掐首尾花括号/方括号；抠不出返回 null（不猜） */
BF.ai.parseJson = function (s) {
  const t = String(s == null ? '' : s).trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { BF.log && BF.log.warn('codec.JSON解析失败：' + (e && e.message)); }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  const aa = t.indexOf('['), bb = t.lastIndexOf(']');
  const cand = (aa >= 0 && aa < a) || a < 0 ? t.slice(aa, bb + 1) : t.slice(a, b + 1);
  if (!cand || cand === 'null') return null;
  try { return JSON.parse(cand); } catch (e) { return null; }
};
BF.ai.readKey = function () {
  const p = BF.ai.currentProvider();
  const saved = BF.settings.get('aiApiKey') || '';
  return saved || p.key || '';
};
BF.ai.hasKey = function () { return !!BF.ai.readKey(); };
/* 无密钥提示统一走 requireKey(where)：返回布尔，同时按 opts.silent 决定是否提示——
   不能有的地方静默跳过、有的弹通用提示、有的 warn，用户看不出差别。
   where 是功能名（如「AI 摘要」），会出现在提示里，用户能知道是哪个功能被拦下了。 */
BF.ai.requireKey = function (where, opts) {
  opts = opts || {};
  if (BF.ai.hasKey()) return true;
  /* 无密钥降级：静默模式仍只返回 false；
     非静默模式提示并给出「复制提示词」降级选项 */
  if (!opts.silent) {
    /* 提示里那句「设置 → AI 服务」要能点：光告诉用户路径，等于让他自己找路。 */
    BF.noti.warn((where ? where + '需要' : '此功能需要') + ' API 密钥（设置 → AI 服务），已跳过',
      { action: { label: '去设置', run: function () { try { BF.settingsUI.open('ai'); } catch (e) { BF.err.report('ai.requireKey.toSettings', e); } } } });
  }
  return false;
};
/* 无密钥降级：把「提示词 + 内容」复制到剪贴板，用户可拿去别处用。
   。返回 true 表示已复制。 */
BF.ai.fallbackCopy = async function (payload, label) {
  try {
    const parts = [];
    if (label) parts.push('【' + label + '】');
    if (payload && payload.prompt) parts.push(payload.prompt);
    if (payload && payload.content) parts.push('\n\n' + String(payload.content).slice(0, 8000));
    const text = parts.join('\n');
    if (!text) return false;
    /* 统一走唯一的 BF.copyText（clipboard API + textarea 兜底双通道），
       失败时返回结构化结果，不再把原始英文异常拼进提示——只给中文结论。
       非安全上下文 / 权限拒绝 / 无剪贴板 API 都不会给用户抛出英文。 */
    const r = await BF.copyText(text);
    if (r && r.ok) { BF.noti.success('未配置密钥，已将' + (label || '提示词') + '复制到剪贴板'); return true; }
    BF.noti.warn('剪贴板不可用，提示词无法复制');
    return false;
  } catch (e) {
    BF.err.report('ai.fallbackCopy', e);
    BF.noti.warn('剪贴板不可用，提示词无法复制');
    return false;
  }
};

