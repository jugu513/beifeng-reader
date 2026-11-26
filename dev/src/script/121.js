/* ================= A8b. 模型价格表与成本估算（#151） =================
   单价口径：人民币 / 1M token，input 与 output 分列。中转与官方目录价会浮动，
   这里是「估算口径」——显示层写明「约」，不承诺账单级精确。
   表外模型（用户自填的中转模型名）按中转常见档位估（¥2 入 / ¥8 出），
   并在返回里标 known:false，显示层可以区分「表内价」与「估档」。 */
BF.ai.PRICES = {
  'glm-4.7-flash': { in: 0, out: 0 },
  'glm-4.6': { in: 2, out: 8 },
  'deepseek-v3': { in: 2, out: 8 },
  'deepseek-r1': { in: 4, out: 16 },
  'kimi-k2': { in: 4, out: 16 },
  'qwen3-max': { in: 2.4, out: 9.6 },
  'doubao-seed': { in: 0.8, out: 2 },
  'gpt-4o-mini': { in: 1.1, out: 4.3 },
  'gpt-4o': { in: 18, out: 72 },
  'claude-haiku': { in: 5.8, out: 29 },
  'claude-sonnet': { in: 22, out: 110 },
};
/* 会话口径累计：不落盘（持久化它自己反而要占配额，且成本是「看一眼」的信号，
   不是账本——真账单以服务商控制台为准）。 */
BF.ai._sessionCost = 0;
BF.ai._lastCost = null;
BF.ai.costOf = function (model, usage) {
  if (!usage) return null;
  const pt = (typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0) ||
             (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0);
  const ct = (typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0) ||
             (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0);
  if (!pt && !ct) return null;
  const name = String(model || BF.settings.get('aiModel') || '').toLowerCase();
  let key = null;
  for (const k in BF.ai.PRICES) { if (name.indexOf(k) >= 0) { key = k; break; } }
  const p = key ? BF.ai.PRICES[key] : { in: 2, out: 8 };
  const cost = pt / 1e6 * p.in + ct / 1e6 * p.out;
  return { cost: cost, pt: pt, ct: ct, known: !!key };
};
/* 网关统一记账：非流式响应带 usage（流式各家普遍不给，按 null 如实跳过）。 */
BF.ai._trackCost = function (out) {
  try {
    const r = BF.ai.costOf(out && out.model, out && out.usage);
    if (r) { BF.ai._lastCost = r; BF.ai._sessionCost += r.cost; }
    return r;
  } catch (e) { return null; }
};
BF.ai.costLabel = function () {
  if (BF.ai._lastCost == null) return '';
  const f = function (n) { return n < 0.01 ? n.toFixed(4) : n.toFixed(2); };
  return '成本（约）：本次 ¥' + f(BF.ai._lastCost.cost) + ' / 会话 ¥' + f(BF.ai._sessionCost) +
    (BF.ai._lastCost.known ? '' : '（表外模型按估档）');
};

