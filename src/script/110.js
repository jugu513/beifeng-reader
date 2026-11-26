/* ================= A2. 网关：并发 + 熔断 + 重试 + 超时 + SSE ================= */
BF.ai.gateway = (function () {
  let _queue = 0;
  /* 熔断与失败计数按服务商分开：全局单键时，一家坏了会把别家一起锁住
     （DeepSeek 连错三次，OpenAI 那边也「暂时停用」）。
     每家一份 { fail, openUntil, tries }，键是 provider id。 */
  const _circuits = {};
  const queue = [];
  function _concurrency() {
    const c = parseInt(BF.settings.get('aiConcurrency'), 10);
    return c >= 1 && c <= 8 ? c : 4;
  }
  function _retries() {
    const r = parseInt(BF.settings.get('aiRetries'), 10);
    return r >= 0 && r <= 4 ? r : 2;
  }
  /* 排队也必须能被中止：以前 _waitForSlot 不认 signal，用户在「停止」时如果这次
     调用还在排队，中止只作用在已发出的请求上，队列里的它照样会拿到槽位并发出
     真实请求（abort 后 calls 仍 +1）。现在两种取消路径都覆盖：
     ① 还在队列里 → 摘掉自己并以 AbortError 结束；
     ② 刚好在摘掉之前被移交 → 立刻把刚接手的槽位让给下一位，再以 AbortError 结束。 */
  function _waitForSlot(signal) {
    return new Promise(function (res, rej) {
      function _abortErr() { const e = new Error('已中止'); e.name = 'AbortError'; return e; }
      if (signal && signal.aborted) { rej(_abortErr()); return; }
      if (_queue < _concurrency()) { _queue++; res(); return; }
      const entry = function () {
        if (signal && signal.aborted) { _releaseSlot(); rej(_abortErr()); return; }
        res();
      };
      queue.push(entry);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () {
          const i = queue.indexOf(entry);
          if (i >= 0) { queue.splice(i, 1); rej(_abortErr()); }
        }, { once: true });
      }
    });
  }
  function _releaseSlot() {
    _queue = Math.max(0, _queue - 1);
    if (queue.length && _queue < _concurrency()) {
      const next = queue.shift();
      _queue++;
      next();
    }
  }
  function _pidNow() {
    try { const p = _effectiveProvider() || {}; return String(p.id || p.name || 'default'); } catch (e) { return 'default'; }
  }
  /* 逐家记住「这家不认流式用量回帧」：stream_options 是扩展字段，严格的兼容端点会当
     未知参数 400 拒掉。带错的代价是整条流式请求失败，不带的代价只是这次没有成本数字。
     只在本次会话记（换网络、换端点后重新试），不落盘 —— 陈旧的能力声明会把成本数字永久关掉。 */
  const _noStreamOpts = {};
  function _ck(id) {
    const k = String(id || 'default');
    if (!_circuits[k]) _circuits[k] = { fail: 0, openUntil: 0, tries: 0 };
    return _circuits[k];
  }
  function _checkCircuit(id) {
    const c = _ck(id);
    if (c.openUntil && Date.now() < c.openUntil) return Math.ceil((c.openUntil - Date.now()) / 1000);
    /* 窗口到期视为半开试探：失败计数必须清零，否则历史累计值会让下一次偶发失败
       立刻重开最长窗口（越用越容易熔断）。 */
    if (c.openUntil) { c.openUntil = 0; c.fail = 0; c.tries = 0; }
    return 0;
  }
  function _openCircuit(id) {
    const c = _ck(id);
    c.tries = Math.min(c.tries + 1, 3);
    const wait = 30000 * Math.pow(2, c.tries - 1);
    c.openUntil = Date.now() + wait;
    BF.log.warn('AI 网关暂停使用服务商 ' + id + ' ' + wait / 1000 + 's（该家连续失败 ' + c.fail + ' 次，其它服务商不受影响）');
  }
  function _markSuccess(id) { const c = _ck(id); c.fail = 0; c.tries = 0; c.openUntil = 0; if (_degradedTo) { BF.log.info('AI 网关已恢复原服务商（不再经 ' + _degradedTo + '）'); _degradedTo = null; } }
  function _markFail(id) { const c = _ck(id); c.fail++; if (c.fail >= 3) _openCircuit(id); }
  /* 熔断三态归零在成功/恢复/手动 reset 三处手抄——收成一个函数，防漂移。
     传 id 只归零那一家；不传清全部（用户手动「重置熔断」）。 */
  function _resetGate(id) {
    if (id) { const c = _ck(id); c.fail = 0; c.openUntil = 0; c.tries = 0; return; }
    for (const k in _circuits) delete _circuits[k];
  }
  function _totalFail() { let n = 0; for (const k in _circuits) n += _circuits[k].fail; return n; }

  /* provider 降级切换：连续 _FAIL_DEGRADE 次失败后，
     自动把当前 provider 切到另一家（custom 除外），成功后恢复原 provider。
     记录在 _degradedTo，成功后由 _markSuccess 复位。
     改道目标必须自带密钥；没有内置密钥，这条路径默认不会发生。 */
  const _FAIL_DEGRADE = 3;
  let _degradedTo = null;   /* 降级后的 provider id（降级中）；null = 未降级 */
  let _refusalLogged = false;   /* 「已关闭自动降级」只留一条日志，避免每次失败刷一条 */
  /* 自动降级会把用户正文改道到另一家服务商——
     连续失败时替用户做这个决定可以，但必须给「拒绝」的出口，且拒绝要
     持久化（设置项 aiAutoDegrade）。缺省/true = 允许降级。 */
  function _autoDegradeOn() { return BF.settings.get('aiAutoDegrade') !== false; }
  function _maybeDegrade() {
    const pid = _pidNow();
    if (_ck(pid).fail < _FAIL_DEGRADE) return;
    if (!_autoDegradeOn()) {
      /* 用户拒绝过降级（或设置里关掉）：保持原服务商，失败即失败，
         不把正文改道第三方。只记一次 warn，之后静默（日志仍全量）。 */
      if (!_refusalLogged) {
        _refusalLogged = true;
        BF.log.warn('AI 网关连续失败，但自动降级已关闭：保持原服务商，正文不会改道第三方');
      }
      return;
    }
    const all = BF.ai.PROVIDERS || [];
    const builtin = all.filter(function (p) { return p && p.id && p.id !== 'custom'; });
    if (builtin.length <= 1) return;
    const cur = (BF.ai.currentProvider() || {}).id;
    const startIdx = Math.max(0, builtin.findIndex(function (p) { return p.id === cur; }));
    /* 降级不能只按数组顺序换下一家：有四家浏览器根本发不出去，
       「换一家」很可能正好换到必然不通的那家，把可用换成不可用再熔断。
       按可达性挑（没探测过的先不算不可用）；一家都不通就直说不换，
       而不是悄悄把正文送过去。 */
    let next = null;
    for (let step = 1; step < builtin.length; step++) {
      const cand = builtin[(startIdx + step) % builtin.length];
      if (!cand || cand.id === cur || !cand.base) continue;
      /* 改道目标必须有自带密钥：用户在「设置 → AI」里填的那把只属于当前选中的那家，
         换到一家没密钥的是把可用换成必然报错 */
      if (!cand.key) continue;
      if (BF.net.mode() === 'proxy' || BF.net.reachable(BF.ai.joinEndpoint(cand.base))) { next = cand; break; }
    }
    if (!next) {
      if (!_refusalLogged) {
        _refusalLogged = true;
        BF.log.warn('AI 网关需要换服务商，但没有可用的备用：其余几家要么没有密钥、要么在浏览器里不可直连（未配本机转发）——不改道、直接报错');
      }
      return;
    }
    if (next.id === cur) return;
    _degradedTo = next.id;
    /* 改道后不需要再清失败计数：计数本就按服务商分键，
       新换的那家从零开始，出错那家的熔断窗口继续生效（它确实坏了）。 */
    /* 降级即把后续对话改道目标服务商的内置通道——通知必须写明
       数据出口变化，不让用户在不知情下把正文送往第三方；并给「拒绝降级」
       出口：点一下即撤回当次降级 + 持久关闭自动降级。 */
    BF.log.warn('AI 网关连续失败，自动降级切换服务商：' + cur + ' → ' + next.id + '（后续请求经其内置通道）');
    BF.noti.warn('AI 服务商 ' + (BF.ai.PROVIDERS.find(function (p) { return p.id === cur; }) || {}).name +
      ' 连续失败，已自动切换 ' + next.name + '（后续对话将经 ' + next.name + ' 的内置通道处理）', {
      action: { label: '拒绝降级', run: function () { refuseDegrade(); } },
    });
  }
  /* 「拒绝并停用降级」出口：撤回已发生的降级、持久关闭
     自动降级。之后失败直接报错——用户明确选择「不把正文改道第三方」时，
     静默继续降级比失败更糟。在途请求已发出的无法追回，提示里如实说明。 */
  function refuseDegrade() {
    try { BF.settings.set('aiAutoDegrade', false); } catch (e) { BF.err && BF.err.report('ai.refuseDegrade', e); }
    _degradedTo = null;
    _resetGate();
    BF.log.warn('用户拒绝 AI 自动降级：已切回原服务商，后续失败将直接提示（不再把正文改道第三方）');
    if (BF.noti && BF.noti.info) BF.noti.info('已拒绝自动降级：后续请求仍走原服务商，失败会直接提示，不会把正文改道第三方');
  }
  function _effectiveProvider() {
    if (_degradedTo) {
      const p = BF.ai.PROVIDERS.find(function (x) { return x && x.id === _degradedTo; });
      if (p) return p;
    }
    return BF.ai.currentProvider();
  }
  function _effectiveEndpoint() {
    const p = _effectiveProvider();
    if (p && p.id === 'custom') return BF.settings.get('aiEndpoint') || '';
    return p ? p.base : '';
  }
  function _effectiveKey() {
    const p = _effectiveProvider();
    /* 降级中优先用目标 provider 的内置 key。saved（用户配给原服务商的
       key）若优先 → 被带到降级端点 → 必 401，"自动切换"沦为"从 401 切到另一个 401"。
       仅当降级目标无内置 key（如 custom）时，才允许用户 saved key。 */
    if (_degradedTo && p && p.key) return p.key;
    const saved = BF.settings.get('aiApiKey') || '';
    return saved || (p && p.key) || '';
  }

  async function call(messages, opts) {
    opts = opts || {};
    /* 总开关：关掉后不发任何 AI 请求（连探测与拉模型也走不到这里）。
       放在取槽位之前抛，免得占着并发槽又立刻失败。 */
    if (BF.settings.get('aiEnabled') === false) throw new Error('AI 功能已停用：设置 → AI 服务里可重新开启');
    const _pid = _pidNow();   /* 本次请求记到哪家服务商的熔断上，全程同一把键 */
    const waitSec = _checkCircuit(_pid);
    if (waitSec > 0) throw new Error('AI 服务暂时不可用，约 ' + waitSec + 's 后重试');
    await _waitForSlot(opts.signal);
    /* 拿到槽位后再核一次：排队期间被中止、而 abort 事件与移交撞在一起的情况，
       entry 里已经拦了一道，这里是同一条判据的兜底，不重复计失败。 */
    if (opts.signal && opts.signal.aborted) { _releaseSlot(); const _ae = new Error('已中止'); _ae.name = 'AbortError'; throw _ae; }
    let _jobId = null;   /* 提升到函数级：未及初始化即抛错时 finally 不踩 TDZ */
    try {
      const endpoint = opts.endpoint || _effectiveEndpoint();
      if (!endpoint) throw new Error('未配置 API 地址');
      /* URL 协议校验：base 只允许 http(s)://，
         防 file:/data:/自定义协议被当探测探针带 Authorization 头发往任意地址 */
      if (!/^https?:\/\//i.test(String(endpoint))) {
        throw new Error('API 地址必须是 http(s):// 开头（当前：' + String(endpoint).slice(0, 60) + '）');
      }
      const key = opts.key || _effectiveKey();
      if (!key) throw new Error('未配置 API 密钥');
      /* 模型智能路由：用户未显式指定模型（opts.model 空）且未锁定
         模型时，auto 模式按历史成功率路由；用户手选模型即锁定（BF.ai.smart.override） */
      let model = opts.model || BF.settings.get('aiModel') || '';
      if (!opts.model && !BF.ai.smart.isLocked('aiModel')) {
        try {
          const prov = _effectiveProvider();
          const rec = (prov && prov.rec) || '';
          if (rec) {
            const r = BF.ai.smart.route('aiModel', [{ id: rec, score: 1 }]);
            if (r.choice && r.choice !== model) model = r.choice;
          }
        } catch (e) {}
      }
      if (!model) model = (BF.ai.currentProvider() && BF.ai.currentProvider().rec) || '';
      /* 没有模型名就别发这次请求，也不兜一个写死的通用模型名——该名字并不在
         服务商目录里时，表现是 HTTP 400「请求格式错误（模型名或参数有误）」，
         用户只会以为是密钥或参数错。
         rec 是否在目录内可逐家核对。 */
      if (!model) throw new Error('未指定模型：到设置 → AI 服务填模型名（这家服务商没有内置推荐模型）');
      const tries = opts.tries != null ? opts.tries : _retries();
      let lastErr = null;
      /* 调用日志：模型/端点/消息数/字符数，密钥不入日志 */
      try {
        BF.log && BF.log.info('AI 调用：' + (BF.ai.currentProvider() && BF.ai.currentProvider().id) +
          ' 模型 ' + model + ' 端点 ' + String(endpoint).replace(/^https?:\/\//, '').slice(0, 40) +
          /* 日志取字符数不必整包 JSON.stringify——大取材时这是一次纯浪费的全量序列化；
             统计以「内容字符数」为准（与整包序列化长度略有差，无功能影响）。 */
          ' 消息 ' + (messages && messages.length) + ' 字符 ' + (messages || []).reduce(function (n, m) { return n + String((m && m.content) || '').length; }, 0));
      } catch (e) {}
      const t0 = Date.now();
      let aborted = false;
      /* netPolicy：浏览器跨域/网络层把请求本身拦掉了（TypeError: Failed to fetch）。
         它不是服务商故障 —— 计失败会熔断，熔断会换家，而换过去的那几家同样是结构性
         发不出去，等于把一次 CORS 拒绝放大成「全部服务商都坏了」。故单列一路，
         不计数、不降级，直接说清原因。 */
      let netPolicy = false;
      /* authReject：服务商明确回了「这把密钥/这个请求本身不行」（400/401/403/404）。
         与 netPolicy 同理要单列一路 —— 它是配置问题而不是这家服务商暂时故障，
         计失败会熔断、熔断会换家，把「你去改密钥」放大成「正文送去别家」。 */
      let authReject = false;
      /* 跨域被拒时 auto 档可以先换本机转发再试一次；只许换一次，避免来回抖。
         _target 是当次真正要打的地址（endpoint 是 try 内的 const，闭包里取不到） */
      let _forceProxy = false, _policyRetried = false, _target = '';
      function _policyReject() {
        if (!_policyRetried) {
          _policyRetried = true;
          if (!_forceProxy && BF.net.noteBlocked(_target)) { _forceProxy = true; return 'reroute'; }
        }
        netPolicy = true;
        return 'break';
      }
      /* AI 请求注册进程：运维台可见且可中止（_jobId 已在函数级声明） */
      function _jobEndOk() { if (_jobId) { try { BF.jobs.end(_jobId); } catch (e) {} _jobId = null; } }
      function _jobFail(err) { if (_jobId) { try { BF.jobs.fail(_jobId, err); } catch (e) {} _jobId = null; } }
      try {
        if (BF.jobs && BF.jobs.begin) {
          const _ctrl = opts.signal ? null : new AbortController();
          _jobId = BF.jobs.begin('AI · ' + model, { kind: 'io', ctrl: opts.signal ? null : _ctrl });
          /* 外部 signal 联动：外部中止 → 中止进程 */
          if (opts.signal && _jobId) {
            opts.signal.addEventListener('abort', function () { try { BF.jobs.abort(_jobId); } catch (e) {} }, { once: true });
          }
        }
      } catch (e) {}
      for (let attempt = 0; attempt <= tries; attempt++) {
        /* 超时与用户中止必须区分：共用 AbortError 时，超时触发的 abort
           会被当成「用户主动停止」——不重试、不计熔断、不降级。
           外部 signal 下若没有内部 ctrl，setTimeout 形同虚设，请求可永久挂起。
           超时始终由内部 ctrl 负责（外部 signal 用 AbortSignal.any 合并，
           不支持则手动联动），超时错误打 __bfTimeout 标记与用户中止区分。 */
        const ctrl = new AbortController();
        let _timedOut = false;
        /* 一律拿内部 ctrl 当 fetch 的 signal：空闲超时能掐、外部中止转成它、结束即解绑。
           不用 AbortSignal.any —— 派生信号会把监听挂在外部 signal 上且没有解绑 API，
           会话级 signal 一长活，每个请求都给它加一个，越问越重。 */
        const signal = ctrl.signal;
        /* 「总时长」式超时会掐断正在正常吐字的长回答。
           改为「无新内容时长」空闲超时：每收到一个 chunk 即重设计时器（见读取循环里的 _armIdle()）。 */
        const _IDLE_MS = (typeof opts.timeout === 'number' && opts.timeout > 0) ? opts.timeout : 120000;
        let _idleTimer = null;
        const _clearIdle = function () { if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; } };
        const _armIdle = function () { _clearIdle(); _idleTimer = setTimeout(function () { _timedOut = true; try { ctrl.abort(); } catch (e) {} }, _IDLE_MS); };
        _armIdle();
        let _unlinkExt = null;
        if (opts.signal) {
          const _onExt = function () { try { ctrl.abort(); } catch (e) {} };
          /* 外部 signal 已经中止：立刻跟着中止（否则带着死信号发出一个必然没人要的请求） */
          if (opts.signal.aborted) _onExt();
          else {
            try {
              opts.signal.addEventListener('abort', _onExt, { once: true });
              _unlinkExt = function () { try { opts.signal.removeEventListener('abort', _onExt); } catch (e) {} };
            } catch (e) {}
          }
        }
        try {
          _target = BF.ai.joinEndpoint(endpoint);
          /* 走不走本机转发由 BF.net 按「传输档 + 探测可达性」决定，这里只问一次 */
          const _pv = _effectiveProvider() || {};
          /* 逐服务商的两个非 OpenAI 开关：auth='api-key' 换鉴权头，
             parts=true 把字符串 content 包成 [{type:'text',text}] 段数组。
             缺省不开，其余服务商走的还是标准 OpenAI 形状。 */
          const _hdrs = { 'Content-Type': 'application/json' };
          if (_pv.auth === 'api-key') _hdrs['api-key'] = key; else _hdrs['Authorization'] = 'Bearer ' + key;
          Object.assign(_hdrs, opts.extraHeaders || {});
          const _msgs = _pv.parts ? messages.map(function (m) {
            return (m && typeof m.content === 'string') ? Object.assign({}, m, { content: [{ type: 'text', text: m.content }] }) : m;
          }) : messages;
          /* 流式带 stream_options.include_usage 才能拿到用量（成本数字）；
             这家被拒过一次（或调用方自己给了）就不带。 */
          const _usageOn = !!(opts.stream && !(opts.body && opts.body.stream_options) && !_noStreamOpts[_pid]);
          const res = await fetch(_forceProxy ? BF.net.viaProxy(_target) : await BF.net.route(_target), {
            method: 'POST',
            headers: _hdrs,
            body: JSON.stringify(Object.assign({
              model: model,
              messages: _msgs,
              stream: !!opts.stream,
            }, opts.body || {}, _usageOn ? { stream_options: { include_usage: true } } : {})),
            signal: signal,
          });
          /* 429：等到 Retry-After 指明的点之后**直接重试**，而不是「白等一场再把这次记成失败」。
             跨域时 Retry-After 不是安全响应头，服务商没 expose 就读不到（恒 null），
             读不到就不承诺「已自动等待」，下面文案也只说触发限流。 */
          if (res.status === 429) {
            const ra = parseInt(res.headers && res.headers.get ? res.headers.get('Retry-After') : null, 10);
            if (attempt < tries) {
              _clearIdle();
              /* 先放掉响应体再等：Retry-After 可长达 10s，挂着的流会一直占连接 */
              try { res.body && res.body.cancel(); } catch (_) {}
              if (ra > 0) await new Promise(r => setTimeout(r, Math.min(ra * 1000, 10000)));
              if (_unlinkExt) { _unlinkExt(); _unlinkExt = null; }   /* 429 重试前解绑外部 abort 监听 */
              continue;
            }
          }
          /* HTTP 状态码 → 用户可读的中文错误。
             原「HTTP 400」让用户无法判断是密钥错、限流还是端点问题。 */
          if (!res.ok) {
            const _codeMap = {
              400: '请求格式错误（模型名或参数有误）',
              401: 'API 密钥无效或已过期：到设置 → AI 服务更新密钥后重试',
              403: '无权限访问（密钥被禁用或端点受限）：核对密钥或更换端点',
              404: '接口地址不存在（端点或模型名错误）：到设置 → AI 服务核对端点与模型',
              408: '请求超时',
              429: '请求过于频繁（触发限流，已自动等待重试）',
              500: '服务商内部错误（稍后重试）',
              502: '网关错误（服务商上游异常）',
              503: '服务暂不可用（过载或维护中）',
              504: '网关超时（服务商响应过慢）',
            };
            const _msg = _codeMap[res.status] || ('HTTP ' + res.status);
            /* 带了用量回帧开关才被 400 拒：记这家一笔，摘掉开关把这一次重发。
               attempt-- 让它不占重试额度；这家本会话后续请求直接不带，不再白撞一次 400。
               不这么做，严格的兼容端点上流式会永久报「请求格式错误」——
               为一个成本数字赔上整条通道不值。 */
            if (res.status === 400 && _usageOn) {
              _noStreamOpts[_pid] = true;
              _clearIdle();
              try { BF.log && BF.log.info('服务商 ' + _pid + ' 不接受流式用量回帧，本次会话改回不带（回答与朗读不受影响）'); } catch (e) {}
              attempt--;
              try { res.body && res.body.cancel(); } catch (_) {}
              continue;
            }
            /* 429 已等待 Retry-After 仍失败，或未带 Retry-After，明确提示限流 */
            const _final = (res.status === 429) ? ('触发限流（429），请降低并发或稍后重试') : _msg;
            const _httpErr = new Error(_final);
            /* 4xx 里的四类是「重发必然同样失败、换家也救不了」：请求体裁错、密钥无效、
               没权限、端点/模型不存在。以前只抛普通 Error，于是这把错密钥会被重试到
               3 次、计入连续失败、把熔断打开，还会触发自动降级——把正文改道另一家。
               现在打标：不重试（__bfNoRetry 已有约定）、不计熔断也不降级（__bfNoDegrade）。
               超时 408 / 限流 429 / 5xx 仍是瞬时错误，保留重试、计数与降级。 */
            if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
              _httpErr.__bfNoRetry = true;
              _httpErr.__bfNoDegrade = true;
            }
            throw _httpErr;
          }
          /* 成功标记推迟到「确认拿到内容」之后：HTTP 200 不等于这次调用成功 ——
             服务商忽略 stream 参数直接回文本、或 choices 为空，都该算失败。
             记成功会把坏模型留在智能路由的候选里，而用户那边只是「点了没反应」。 */
          if (!opts.stream) {
            let j = null;
            try { j = await res.json(); }
            catch (e) {
              _clearIdle();
              /* 重发同一请求必然同样失败，打标不重试；原生 JSON 报错对用户是天书，
                 也不把响应片段回显出去 */
              const err = new Error('该服务商未按非流式返回（响应不是 JSON），请改开流式或换一个服务商');
              err.__bfNoRetry = true;
              throw err;
            }
            const msg = j && j.choices && j.choices[0] && j.choices[0].message;
            const content = (msg && msg.content) || '';
            if (!content) {
              _clearIdle();
              const err = new Error('模型没返回内容（choices 为空）');
              err.__bfNoRetry = true;
              throw err;
            }
            _clearIdle();
            _markSuccess(_pid);
            try { BF.ai.smart.record('aiModel', model, { ok: true, ms: Date.now() - t0 }); } catch (e) {}
            _jobEndOk();
            /* 两种传输形态从此同形。过去非流式原样返回服务商 JSON，调用方各抄一条
               `.choices[0].message.content`；抄漏一处就静默失效 —— AI 分章、打标签、
               导入摘要增强四处正是读 `.content` 却拿到 undefined，整条链一次也没跑过。
               raw 保留原始响应体，需要 usage/id/模型名等原字段的调用方不必改读法。 */
            const _ret = { content: content, reasoning: (msg.reasoning_content || ''), usage: j.usage || null, model: j.model || model, done: true, raw: j };
            BF.ai._trackCost(_ret);   /* 成本估算记账（usage 缺失时如实跳过） */
            return _ret;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          const out = { content: '', reasoning: '', done: false };
          let _streamUsage = null;   /* 流式末帧回报的 token 用量（include_usage），无则保持 null */
          const emit = opts.onDelta || function () {};
          /* 单行解析抽成函数，循环内复用，并在流结束后对残留 buf 再做一次 flush。 */
          let _badFrames = 0;   /* 帧解析失败计数：全坏时错误消息要指向真因，而不是「不支持流式」 */
          const processLine = function (raw) {
            const t = raw.trim();
            if (t.slice(0, 5) !== 'data:') return;
            const data = t.slice(5).replace(/^\s/, '');
            if (data === '[DONE]') { out.done = true; return; }
            try {
              const j = JSON.parse(data);
              /* include_usage 末帧：usage 在顶层（不在 delta），必须单独收，否则流式永远 null */
              if (j.usage) _streamUsage = j.usage;
              const delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (delta) {
                if (delta.reasoning_content) { out.reasoning += delta.reasoning_content; emit({ type: 'reasoning', text: delta.reasoning_content }); }
                if (delta.content) { out.content += delta.content; emit({ type: 'content', text: delta.content }); }
              }
            } catch (e) { _badFrames++; }
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            _armIdle();   /* 收到新数据即重置空闲超时，长回答不被掐断 */
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) processLine(line);
          }
          /* 流结束时 buf 可能残留最后一帧（服务端/代理/Nginx 缓冲边界常不带尾换行）；
             同时把 TextDecoder 内部尾部缓冲吐出，避免丢字节。 */
          try { buf += decoder.decode('', { stream: false }); } catch (e) {}
          if (buf && buf.trim()) { const _tail = buf; buf = ''; processLine(_tail); }
          out.done = true;   /* 正常 EOF 即视为完整（不依赖服务端发 [DONE]） */
          _clearIdle();
          /* 流式跑完却一个字都没有＝失败。服务商不认 stream 参数时就是这个形态，
             让它带着空内容「成功」返回，上层会把空摘要写进库、还记一次模型成功。 */
          if (!out.content && !out.reasoning) {
            const err = new Error('未收到内容（该服务商可能不支持流式返回' + (_badFrames ? '，另有 ' + _badFrames + ' 帧无法解析' : '') + '）');
            err.__bfNoRetry = true;
            throw err;
          }
          _markSuccess(_pid);
          try { BF.ai.smart.record('aiModel', model, { ok: true, ms: Date.now() - t0 }); } catch (e) {}
          _jobEndOk();
          out.usage = _streamUsage; out.model = model; out.raw = null;   /* 与非流式同形：usage 取流式末帧回报（不支持的服务商保持 null） */
          BF.ai._trackCost(out);   /* 流式成本记账：usage 缺失时如实跳过（_trackCost 内部判空） */
          return out;
        } catch (e) {
          lastErr = e;
          _clearIdle();
          if (_unlinkExt) { _unlinkExt(); _unlinkExt = null; }
          /* 超时 abort 打标：与用户主动中止区分——超时属正常失败，
             走重试/熔断/降级；用户中止不计失败（aborted = true 后 break）。 */
          if (_timedOut && e && e.name === 'AbortError') {
            try { e.__bfTimeout = true; e.__bfTimeoutSec = Math.round(_IDLE_MS / 1000); e.message = '响应超时（' + Math.round(_IDLE_MS / 1000) + 's 内未收到新内容）'; } catch (_) {}
            /* break 而不是 throw：超时是正常失败，下面的熔断计数与降级必须执行
               （throw 会直穿到调用方，挂死的服务商永远进不了黑表）。 */
            break;
          }
          if (e && e.name === 'AbortError' && !e.__bfTimeout) { aborted = true; _jobFail(e.message || '已中止'); break; }   /* 用户主动停止不计入失败熔断 */
          /* 重发同一请求必然同样失败的（响应体裁不对、模型没回话、密钥/端点/参数错）
             不占重试预算。其中带 __bfNoDegrade 的是配置问题，连失败计数与换家一起跳过。 */
          if (e && e.__bfNoRetry) { if (e.__bfNoDegrade) authReject = true; break; }
          /* 跨域/网络层拒绝：页面只能拿到 TypeError: Failed to fetch（Firefox 措辞
             NetworkError、Safari「Load failed」），拿不到状态码。auto 档配了本机转发
             就先换条路再试一次；仍不通就单独定性 —— 不进失败计数、不熔断、不换家，
             因为换过去的那几家同样结构性发不出去，一次 CORS 拒绝会被放大成
             「全部服务商都坏了」。
             判据只看「消息像网络层拒绝」，不能拿 e.name === 'TypeError' 当判据：
             res.body 为空、getReader 不存在、messages 形状不对这类代码内 TypeError
             也会被报成「被浏览器的跨域策略拦下」——文案与真实原因无关，用户照着去查
             CORS 查不出来。真网络拒绝的消息本来就带这些词，不收窄也不漏。 */
          if (!e || (!e.__bfTimeout && /failed to fetch|networkerror|err_network|err_connection|load failed|网络请求失败/i.test(String((e && e.message) || '')))) { if (_policyReject() === 'reroute') continue; break; }
          if (attempt < tries) {
            await new Promise(r => setTimeout(r, Math.min(600 * Math.pow(1.5, attempt), 10000)));
          }
        } finally {
          /* 每次尝试结束都解绑外部 abort 监听：以前只在异常与 429 重试路径解绑，
             请求成功返回时监听器仍挂在会话级 signal 上，问得越多挂得越多。 */
          if (_unlinkExt) { _unlinkExt(); _unlinkExt = null; }
        }
      }
      /* 跨域/网络层拒绝单独出口：不计失败、不降级，文案直说这是浏览器拦的 */
      if (netPolicy) {
        _jobFail('连不上（可能被浏览器跨域策略拦下）');
        throw new Error('该地址不允许浏览器直连：请求被浏览器的跨域策略拦下，与密钥无关。' +
          '可启用本机转发（设置 → AI 服务 → 导出转发脚本，启动后把地址填进「本机转发地址」），或改用支持浏览器直连的服务商。');
      }
      /* 正常失败才记熔断 + 尝试降级；用户主动停止（aborted）与配置类拒绝（authReject）跳过 */
      if (!aborted && !authReject) {
        _markFail(_pid);
        try { BF.ai.smart.record('aiModel', model, { ok: false, ms: Date.now() - t0 }); } catch (e) {}
        _maybeDegrade();
      }
      _jobFail((lastErr && lastErr.message) || 'AI 请求失败');
      throw lastErr || new Error('AI 请求失败');
    } finally {
      /* 兜底：任何未清理的 job 都 end（避免幽灵任务） */
      if (_jobId) { try { BF.jobs.end(_jobId); } catch (e) {} _jobId = null; }
      _releaseSlot();
    }
  }
  /* 拉取模型目录：GET {base}/models（OpenAI 兼容）。只读、不送正文；
     密钥只进请求头、不进日志、不进返回值。失败不抛——返回
     { ok, models, error, status }，由界面把原因翻成人话：
     密钥/权限、服务商不提供、需要本机转发、超时、格式不兼容。 */
  async function listModels() {
    const endpoint = _effectiveEndpoint();
    if (!endpoint) return { ok: false, error: '未配置 API 地址' };
    const key = _effectiveKey();
    if (!key) return { ok: false, error: '未配置 API 密钥' };
    let url = String(endpoint).replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(url)) url = url.replace(/\/chat\/completions$/i, '/models');
    else url = url + '/models';
    const p = _effectiveProvider() || {};
    const hdrs = { Accept: 'application/json' };
    if (p.auth === 'api-key') hdrs['api-key'] = key; else hdrs.Authorization = 'Bearer ' + key;
    const ac = new AbortController();
    const t = BF.timers.timeout(function () { try { ac.abort(); } catch (e) {} }, 12000);
    /* 列模型与对话共用同一家服务商的额度：不过并发闸的话，连点「拉取模型」
       就是十个请求一起打出去，而 429 退避与重试预算只护住了 call。 */
    let _slot = false;
    try { await _waitForSlot(ac.signal); _slot = true; }
    catch (e) { try { t(); } catch (e2) {} return { ok: false, error: '已中止' }; }
    try {
      const res = await fetch(await BF.net.route(url), { method: 'GET', headers: hdrs, signal: ac.signal });
      if (!res.ok) {
        const st = res.status;
        return { ok: false, status: st, error: (st === 401 || st === 403) ? '密钥无效或没有列模型权限'
          : st === 404 ? '这家服务商不提供模型列表接口（404）' : ('HTTP ' + st) };
      }
      const js = await res.json().catch(function () { return null; });
      let arr = [];
      if (js && Array.isArray(js.data)) arr = js.data.map(function (x) { return (x && (x.id || x.name)) || ''; });
      else if (js && Array.isArray(js.models)) arr = js.models.map(function (x) { return (x && (x.id || x.name || x)) || ''; });
      arr = arr.filter(function (s) { return typeof s === 'string' && s; }).sort();
      if (!arr.length) return { ok: false, error: '接口有响应但解析不出模型名（可能不是 OpenAI 兼容格式）' };
      return { ok: true, models: arr, provider: p.id || '' };
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      return { ok: false, error: aborted ? '拉取超时（12s），可重试'
        : ('网络失败：' + ((e && e.message) || e) + '（多数服务商需先导出并启动本机转发）') };
    } finally { if (_slot) _releaseSlot(); try { t(); } catch (e3) {} }
  }

  return { call, listModels: listModels, queueLength: function () { return queue.length; }, failCount: function (id) { return id ? _ck(id).fail : _totalFail(); }, circuitWait: function (id) { return _checkCircuit(id || _pidNow()); }, resetCircuit: function () { _resetGate(); }, providersCircuit: function () { const o = {}; for (const k in _circuits) o[k] = { fail: _circuits[k].fail, waitSec: _checkCircuit(k) }; return o; }, degradedTo: function () { return _degradedTo; }, refuseDegrade: refuseDegrade, autoDegradeOn: function () { return _autoDegradeOn(); } };
})();
