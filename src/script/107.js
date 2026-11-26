/* ================= A1b. 网络可达性与传输路由 =================
   「这家服务商能不能被浏览器直连」以前只靠 PROVIDERS.network 里的一句人话猜，
   而那个字段全库没有任何读取点。智谱 / NVIDIA / GitHub Models 不回 CORS 头、
   讯飞预检直接 403 —— 这四家从页面**结构性发不出去**，密钥填对也没用，
   而界面把它们统一写成「需加速」，用户照着换密钥换网络都修不好。
   这里把这件事变成可验证的探测 + 一条可锁的路由开关：
   · 探测＝从页面发一次 OPTIONS。真请求（带 Authorization + JSON）本来就要先过预检，
     所以预检通不通与真请求通不通是同一条判据，不需要凭据也不发正文；
   · 结果只在内存：服务商的 CORS 配置会变，落盘就是把过期结论当事实；
   · 传输档 auto/direct/proxy 由用户定，代理指本机转发器（源码在 BF.ai.PROXY_SRC_FN，可导出）。 */
BF.net = (function () {
  const TTL = 5 * 60000;
  const _state = {};   /* origin -> {direct:boolean, at:ms}（内存态） */
  const _cap = {};     /* origin -> {tools:boolean, at:ms}    （内存态） */
  function originOf(url) { try { return new URL(url).origin; } catch (e) { return String(url || '').slice(0, 60); } }
  function proxyBase() { return String(BF.settings.get('aiProxyBase') || '').trim().replace(/\/+$/, ''); }
  function mode() { const m = BF.settings.get('aiTransport'); return (m === 'direct' || m === 'proxy') ? m : 'auto'; }
  function hasProxy() { return !!proxyBase(); }
  /* 转发器必须是本机回环：这个地址是用户可写字符串（预设也能带），
     指到任意主机就等于把 Authorization 与正文一起送到那边。 */
  function _loopback(u) {
    try {
      const h = new URL(u).hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
    } catch (e) { return false; }
  }
  let _nonLoopWarned = false;
  function viaProxy(url) {
    if (!hasProxy()) {
      if (mode() === 'proxy') throw new Error('已选「本机转发」但转发地址为空：到设置 → AI 服务填写地址，或把传输档改回自动');
      return url;
    }
    const base = proxyBase();
    if (!_loopback(base)) {
      /* 显式 proxy 档不能静默改直连（用户会看到莫名其妙的跨域失败，以为转发器坏了） */
      if (mode() === 'proxy') {
        try { BF.noti && BF.noti.warn('转发地址不是本机回环地址，已中止本次请求（避免把密钥发往第三方）。请改成 127.0.0.1 或 localhost。'); } catch (e) {}
        throw new Error('本机转发地址必须是回环地址（127.0.0.1 / localhost），当前地址不可用');
      }
      if (!_nonLoopWarned) {
        _nonLoopWarned = true;
        try { BF.log && BF.log.warn('本机转发地址不是回环地址，已按直连处理（避免把密钥发往第三方）：' + base); } catch (e) {}
      }
      return url;
    }
    return base + '/?to=' + encodeURIComponent(url);
  }
  function cachedDirect(url) { const s = _state[originOf(url)]; return (s && Date.now() - s.at < TTL) ? s.direct : null; }
  async function probeDirect(url) {
    const o = originOf(url);
    let ok = false;
    try {
      await fetch(url, { method: 'OPTIONS', mode: 'cors', cache: 'no-store' });
      ok = true;
    } catch (e) { ok = false; }
    _state[o] = { direct: ok, at: Date.now() };
    return ok;
  }
  /* 真要发出去的那个地址。
     auto 档刻意**不预先 OPTIONS**：未测过时先直连，被跨域拦下就走 noteBlocked + 换道重试，
     同一次调用内就学到结论 —— 预检每次调用多打一发请求，还给控制台添一条 CORS 报错。
     预检只留给「探测各服务商」按钮这种显式动作。 */
  async function route(url) {
    const m = mode();
    if (m === 'direct') return url;
    if (m === 'proxy') return viaProxy(url);
    return cachedDirect(url) === false && hasProxy() ? viaProxy(url) : url;
  }
  /* 真请求被跨域/网络层拒了：记下来；auto 档且配了转发地址 ⇒ 值得换条路再试一次 */
  function noteBlocked(url) { _state[originOf(url)] = { direct: false, at: Date.now() }; return mode() === 'auto' && hasProxy(); }
  /* 降级候选的可用性过滤：没探测过的（null）不当成不可用，避免探测没跑过时谁都不许换 */
  function reachable(url) { const c = cachedDirect(url); return c === null ? true : c; }
  function capOf(url) { const s = _cap[originOf(url)]; return (s && Date.now() - s.at < TTL) ? s.tools : null; }
  function setCap(url, v) { _cap[originOf(url)] = { tools: v, at: Date.now() }; }
  /* 工具调用能力档：auto=按探测结果；探测过才用 tools，否则退回 JSON 文本。
     判错方向的代价不对称——升错档＝功能直接失败，降错档＝只是解析质量差。 */
  function toolsMode() {
    const m = BF.settings.get('aiModelMode');
    if (m === 'tools' || m === 'plain') return m;
    return 'auto';
  }
  function statusText() {
    const rows = BF.ai.PROVIDERS.filter(function (p) { return p.base; }).map(function (p) {
      const o = originOf(p.base), s = _state[o];
      const mark = !s ? '未测' : (s.direct ? '直连 ✓' : '需转发 ✗');
      return p.name + ' ' + mark;
    });
    return rows.join(' · ');
  }
  async function probeAll() {
    const list = BF.ai.PROVIDERS.filter(function (p) { return p.base; });
    for (let i = 0; i < list.length; i++) { await probeDirect(BF.ai.joinEndpoint(list[i].base)); }
    return statusText();
  }
  return { route, probeDirect, probeAll, noteBlocked, reachable, hasProxy, proxyBase, viaProxy, mode,
    toolsMode, capOf, setCap, statusText, originOf };
})();
