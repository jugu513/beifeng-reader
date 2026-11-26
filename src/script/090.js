/* ================= T12. 在线语音静默自检 =================
   Edge 通道的失效在浏览器里长得一模一样：握手被拒、零音频、close 1006 —— WebSocket
   不暴露 HTTP 状态码，「是不是 403」只能靠时序与差分实验推断。
   2026-11 实测只有「2- 前缀 + v2 令牌」一种构造能过握手，差分表已收窄到这一条；
   换版本声明 / 换线路 / 去 GEC 三个差异维度都被服务端 403 钉死，不再当候选。

   纪律（违反任何一条都会变成「探针把用户流量吃光」）：
   - 静默：不建任何音频节点，只建 WS → 发配置与单字 SSML → 数帧 → 丢弃；
   - 串行：同一时刻最多一条探测连接；
   - 频控：单会话 ≤3 次、冷却 10 分钟；手动「测一次」无视所有限制；
   - 6s 硬超时；朗读开始即中止探测（真实播放优先）；
   - 差分顺序：默认组合 → 换版本声明 → 换线路 → 去 GEC（v1 令牌）→ 全败定封锁。
   浏览器不能改 WebSocket 的 User-Agent 头，「换客户端标识」在这里
   落为换 Sec-MS-GEC-Version 声明 —— 这是协议层唯一能从 JS 摸到的同义变量。
   本机判定与文案不动手修线：探针只把失效归类并说清，能不能修是自愈层的事。 */
BF.tts.health = (function () {
  const LS_KEY = 'tts_health';
  const COOLDOWN = 10 * 60 * 1000;
  const CAP = 3;
  const HARD_TIMEOUT = 6000;
  /* 线路不再在本模块抄一份常量：探针与正式朗读都从 BF.tts.edge 取当前生效端点，
     两处各写一遍是「探针通了、朗读仍坏」这类误判的源头。 */
  /* 八态人话文案：能自愈的说「已…」，不能自愈的说「建议…」；
     技术细节进诊断字段，不进界面主句。 */
  const COPY = {
    OK: { text: '在线语音正常', act: '' },
    NET_OFFLINE: { text: '当前离线', detail: '设备未联网', act: '已切本地语音' },
    NET_BLOCKED: { text: '不可用（网络受限）', detail: '6 秒内未能建立连接', act: '建议改用本地语音' },
    CLOCK_SKEW: { text: '受限（已校正时间偏差）', detail: '本机时钟与服务器差一个签名窗，已按偏移窗计算', act: '已自动处理' },

    POLICY_BLOCKED: { text: '不可用（服务策略变更）', detail: '服务端拒绝连接，多为出口网络或地区策略', act: '建议改用本地语音' },
    ABORTED: { text: '未完成（被朗读打断）', detail: '', act: '' },
  };
  const st = {
    state: 'unknown',   /* unknown | healthy | degraded | suspect | broken */
    code: null, latency: 0, skew: 0, lastProbe: 0,
    endpoint: 'bing', tokenMode: 'v2', uaProfile: 'default',
    history: [],        /* 内存态：最近 10 次 {t, code, ms}，不落盘 */
  };
  let _busy = false;
  let _sessionCount = 0;
  let _started = false;
  /* 在线通道是否被真用过一次（由 BF.tts.edge.synthesize 打点）。
     首探资格必须有它：默认引擎是 auto、在线开关是开，光看这两条等于
     「每个用户一打开书就静默连三次外部服务」——他没要朗读，也先用不上诊断。 */
  let _onlineTouched = false;
  /* 只存这五样：状态、判定码、时间、线路、令牌模式。
     过期结论（时延、历史）不进盘 —— 用户换网络后旧结论会把「可用」说成「不可用」。 */
  function persist() {
    try { BF.store.lsSet(LS_KEY, { state: st.state, code: st.code, lastProbe: st.lastProbe, endpoint: st.endpoint, tokenMode: st.tokenMode }); } catch (e) {}
  }
  function load() {
    try {
      const v = BF.store.lsGet(LS_KEY, null);
      if (v && typeof v === 'object') {
        ['state', 'code', 'lastProbe', 'endpoint', 'tokenMode'].forEach(function (k) { if (v[k] !== undefined) st[k] = v[k]; });
      }
    } catch (e) {}
  }
  function canProbe() {
    if (!BF.tts.edge || !BF.tts.edge.canUse()) return false;
    if (BF.settings.get('ttsAutoOnline') === false) return false;   /* 在线语音整体关闭 → 零探测 */
    if (!_onlineTouched) return false;   /* 没真用过在线通道 → 不自作主张发探测包（手动「测一次」走 force，不受此限） */
    return true;
  }
  /* 差分profile：url 构造与正式朗读同构（token / GEC / 版本声明 / 线路四件套）。
     gecMode 'v1' = 不带 Sec-MS-GEC（纯 TrustedClientToken 的旧形态）。 */
  function buildUrl(p, connId, gec) {
    let u = p.wsBase + '?TrustedClientToken=' + edgeTokenPub() + '&ConnectionId=' + connId;
    if (p.gec !== 'v1') u += '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + p.secVer;
    return u;
  }
  function edgeTokenPub() {
    try { return ((BF.settings && BF.settings.get('edgeToken')) || '') || (BF.CONFIG.EDGE && BF.CONFIG.EDGE.token) || ''; } catch (e) { return ''; }
  }
  async function gecFor() {
    /* 令牌算法与正式路径同源：直接借 edge 引擎的 v2 计算。
       原来这里另算一份标准 SHA-256（v1 形态）冒充 v2 塞进 Sec-MS-GEC，
       探针永远 403、差分组合全灭 → 恒判 POLICY_BLOCKED，而正式朗读其实是好的。 */
    return BF.tts.edge.gec();
  }
  /* 单次静默合成：「测」一个字。只数帧、不建音频节点。 */
  function probeOnce(p) {
    return new Promise(async function (resolve) {
      const t0 = Date.now();
      let settled = false, opened = false, bytes = 0, ws = null, timer = null;
      const done = function (code) {
        if (settled) return;
        settled = true;
        if (timer) { try { timer(); } catch (e) {} }
        try { if (ws) ws.close(); } catch (e) {}
        resolve({ code: code, ms: Date.now() - t0, bytes: bytes });
      };
      let gec = '';
      try { gec = p.gec === 'v1' ? '' : await gecFor(); } catch (e) { return done('LOCAL_ERR'); }
      try { ws = new WebSocket(buildUrl(p, 'h' + Math.random().toString(36).slice(2, 12), gec)); } catch (e) { return done('HANDSHAKE_REJECT'); }
      ws.binaryType = 'arraybuffer';
      timer = BF.timers.timeout(function () { done(opened ? 'STALL' : 'TIMEOUT'); }, HARD_TIMEOUT);
      ws.onopen = function () {
        opened = true;
        try {
          ws.send('Path:speech.config\r\nX-Timestamp:' + new Date().toISOString() + '\r\nContent-Type:application/json; charset=utf-8\r\n\r\n' +
            JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }));
          ws.send('X-RequestId:' + Math.random().toString(36).slice(2, 14) + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + new Date().toISOString() + 'Z\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural"><prosody rate="+0%" pitch="default">测</prosody></voice></speak>');
        } catch (e) { done('LOCAL_ERR'); }
      };
      ws.onmessage = function (ev) {
        if (typeof ev.data === 'string') { if (ev.data.indexOf('Path:turn.end') >= 0) done(bytes > 0 ? 'OK' : 'NO_AUDIO'); return; }
        bytes += Math.max(0, (ev.data.byteLength || 0) - 2);
      };
      ws.onclose = function () {
        if (!opened) done('HANDSHAKE_REJECT');
        else done(bytes > 0 ? 'OK' : 'NO_AUDIO');
      };
      ws.onerror = function () { /* onclose 会跟着来，判定在 onclose */ };
    });
  }
  /* 时钟偏差：HEAD 读 Date 响应头（CORS 安全头）。偏差 >300s 先校正再探。 */
  /* 时钟偏差从这里读，不再自己算：
     跨源 HEAD 想读的 Date 头在 JS 侧拿不到（没有 CORS 头时 fetch 直接 reject），
     旧实现每轮白搭一条请求并在控制台留两条红。真正的自愈在连接层
     （BF.tts.edge 的 ±1 窗盲试），它命中后 _skewMs 就驻留在客户端里。 */
  function clientSkew() {
    try { return (BF.tts.edge && BF.tts.edge.skewMs) ? BF.tts.edge.skewMs() : 0; } catch (e) { return 0; }
  }
  function profiles() {
    const cur = (BF.settings.get('edgeSecVer') || (BF.CONFIG.EDGE && BF.CONFIG.EDGE.secVer) || '2-143.0.3650.75');
    /* 差分表按 2026-11 实测收窄：只有「2- 前缀 + v2 令牌」这一种构造能过握手；
       1- 前缀、无 GEC、备用端点都被服务端 403，留当候选只是白烧三轮握手
       再落到同一个 POLICY_BLOCKED。负对照的价值在注释，不在请求里。 */
    return [{ name: 'default', wsBase: BF.tts.edge.wsBase(), secVer: cur, gec: 'v2' }];
  }
  function record(code, ms) {
    st.lastProbe = Date.now();
    st.latency = code === 'OK' ? ms : 0;
    st.history.push({ t: st.lastProbe, code: code, ms: ms });
    if (st.history.length > 10) st.history.shift();
  }
  /* 主入口：一次自检 = 网络分层判定 + 差分。返回判定码。 */
  async function run(force) {
    if (_busy) return st.code || 'BUSY';
    if (!force) {
      if (!canProbe()) return 'SKIPPED';
      if (_sessionCount >= CAP) return 'SKIPPED';
      if (st.lastProbe && Date.now() - st.lastProbe < COOLDOWN) return 'SKIPPED';
    }
    _busy = true;
    _sessionCount++;
    st.state = 'probing';
    try {
      /* ① 离线 */
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { st.state = 'broken'; st.code = 'NET_OFFLINE'; record('NET_OFFLINE', 0); persist(); return 'NET_OFFLINE'; }
      /* ② / ③ 时钟偏差不再自己测（见上方 clientSkew 注释）：只读连接层已生效的窗偏移。
         探针通但偏移非 0 ⇒ 这条线路是靠纠偏才通的，判成 CLOCK_SKEW，
         让人知道「本机时钟和服务器不一致」，而不是误报服务坏了。 */
      st.skew = clientSkew();
      /* ④ 差分：谁先通定谁，命中组合持久化 */
      const ps = profiles();
      let _sawTimeout = false;
      for (let i = 0; i < ps.length; i++) {
        if (BF.tts.state && BF.tts.state.playing) { st.state = st.code === 'OK' ? 'healthy' : st.state; record('ABORTED', 0); return 'ABORTED'; }
        const r = await probeOnce(ps[i]);
        record(r.code, r.ms);
        if (r.code === 'TIMEOUT' || r.code === 'STALL') _sawTimeout = true;
        if (r.code === 'OK') {
          st.skew = clientSkew();
          st.code = st.skew ? 'CLOCK_SKEW' : 'OK';
          st.state = 'healthy';
          st.latency = r.ms;
          st.endpoint = 'bing';
          st.tokenMode = 'v2';
          persist();
          return st.code;
        }
      }
      /* 全败二分：等到超时 = 连接都建不起来（网络 / 出口拦）；秒拒 = 对端明确拒绝（策略） */
      /* 旧实现会把「线路迁移」覆盖落盘，刷新后读回来连打迁移端点，内置端点再也没有
         试的机会，一次迁移变成永久钉死。覆盖已随 epV3 候选一并摘除。 */
      st.code = _sawTimeout ? 'NET_BLOCKED' : 'POLICY_BLOCKED';
      st.state = 'broken';
      persist();
      return st.code;
    } catch (e) {
      st.code = 'NET_BLOCKED';
      st.state = 'broken';
      record('NET_BLOCKED', 0);
      persist();
      return 'NET_BLOCKED';
    } finally { _busy = false; }
  }
  function status() {
    const c = COPY[st.code] || { text: '未检测', detail: '', act: '' };
    return {
      state: st.state, code: st.code,
      text: st.code ? c.text : '未检测',
      detail: c.detail || '', act: c.act || '',
      latency: st.latency, lastProbe: st.lastProbe, sessionCount: _sessionCount,
      diag: 'code=' + st.code + ' state=' + st.state + ' latency=' + st.latency + 'ms skew=' + st.skew + 'ms endpoint=' + st.endpoint + ' tokenMode=' + st.tokenMode + ' at=' + (st.lastProbe ? new Date(st.lastProbe).toLocaleString('zh-CN') : '-'),
    };
  }
  /* 播放失败联动：真实播放连续两次失败才推到 suspect 并触发一次探测
     （限额照查）。顺序不能反 —— 探测不替代播放重试，先让 L1 重试跑。
     单次抖动不进 suspect。 */
  let _failStreak = 0;
  function notePlayFailure() {
    _failStreak++;
    if (_failStreak >= 2) { st.state = (st.state === 'healthy' || st.state === 'degraded') ? 'suspect' : st.state; run(false); }
  }
  function notePlayOk() {
    _failStreak = 0;
    if (st.state === 'suspect' || st.state === 'broken') st.state = 'degraded';
    else if (st.state === 'unknown') st.state = 'healthy';
  }
  function init() {
    load();
    if (_started) return;
    _started = true;
    /* 这里不排「启动 3 秒后必探」的定时器。默认引擎是 auto、在线开关是开，
       光凭这两条就静默连三次外部服务，是用户没要的流量，还会在控制台留下
       与服务无关的红。首探资格见 canProbe（真用过在线通道才算）；
       设置页「测一次」走 force，任何时候都能主动查。 */
  }
  function noteOnlineAttempt() { _onlineTouched = true; }
  return { init: init, run: run, status: status, notePlayFailure: notePlayFailure, notePlayOk: notePlayOk, noteOnlineAttempt: noteOnlineAttempt, state: st };
})();

