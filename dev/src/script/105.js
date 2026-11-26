/* ================= A1. Provider 列表 ================= */
BF.ai.PROVIDERS = [
  { id: 'tokenriver', name: 'TokenRiver', base: 'https://api.tokenriver.cn/v1', network: '国内可达', note: 'deepseek-flash', rec: 'deepseek-flash', key: '' },
  { id: 'zhipu', name: '智谱', base: 'https://open.bigmodel.cn/api/paas/v4', network: '国内可达', note: 'glm-5.3-flash', rec: 'glm-5.3-flash', key: '' },
  { id: 'nvidia', name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', network: '需加速', note: '目录内模型多', rec: 'deepseek-ai/deepseek-v4.1-flash', key: '' },
  { id: 'xinghuo', name: '讯飞', base: 'https://spark-api-open.xf-yun.com/v1', network: '国内可达', note: 'lite 免费', rec: 'generalv3.5', key: '' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', network: '需加速', note: '聚合', rec: 'openrouter/auto', key: '' },
  { id: 'github', name: 'GitHub Models', base: 'https://models.github.ai/inference', network: '需 GitHub 加速', note: 'gpt-4.1-mini 免费', rec: 'gpt-4.1-mini', key: '' },
  { id: 'volc', name: '火山方舟', base: 'https://ark.cn-beijing.volces.com/api/v3', network: '国内可达', note: '豆包', rec: 'doubao-lite-128k-240428', key: '' },
  { id: 'diandian', name: '点点 dots3', base: 'https://note3-prev-api.askdiandian.com/v1', network: '待实测', note: 'dots3-note-prev', rec: 'dots3-note-prev', auth: 'api-key', parts: true, key: '' },
  { id: 'custom', name: '自定义', base: '', network: '', note: '任意 OpenAI 兼容端点', rec: '', key: '' },
];
BF.ai.currentProvider = function () {
  const id = BF.settings.get('aiProvider') || 'tokenriver';
  return BF.ai.PROVIDERS.find(p => p.id === id) || BF.ai.PROVIDERS[0];
};
BF.ai.providerBase = function () {
  const p = BF.ai.currentProvider();
  if (p.id === 'custom') return BF.settings.get('aiEndpoint') || '';
  return p.base;
};
/* 端点归一（一处实现）。内置 base 到 /v1 为止、由代码补 /chat/completions；
   但用户从服务商文档里粘的是**那条完整地址**，也常带尾斜杠 —— 直接相加会拼成
   /chat/completions/chat/completions 与 //，两类网关都回 404。
   这里只做形态归一，不补协议前缀（协议校验留在 call 里，拒 file:/data: 那一条不能松）。 */
BF.ai.joinEndpoint = function (base, seg) {
  const s0 = String(base == null ? '' : base).trim();
  const p = seg || '/chat/completions';
  if (!s0) return '';
  const s = s0.replace(/\/+$/, '');
  return s.slice(-p.length) === p ? s : s + p;
};
