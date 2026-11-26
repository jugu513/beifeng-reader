/* ================= T4. Edge 引擎（wss） ================= */
BF.tts.edge = (function () {
  /* S5：凭据/端点统一引用 BF.CONFIG.EDGE（可覆盖），不再硬编码在模块内 */
  const _cfg = (BF.CONFIG && BF.CONFIG.EDGE) || {};
  const WS_BASE = _cfg.wsBase || 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  const TOKEN_DEFAULT = _cfg.token || '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  /* N5 token 去内置：优先用用户在「设置→语音→Edge 凭据 Token」填的覆盖值，
     为空回落内置公开 TrustedClientToken。微软轮换后者时用户可自填新值，
     无需等待发版；失效时一等诊断 + 引导填 Token（不静默回退离线）。 */
  function edgeToken() { return ((BF.settings && BF.settings.get) ? (BF.settings.get('edgeToken') || '') : '') || TOKEN_DEFAULT; }
  const SEC_VER = _cfg.secVer || '2-143.0.3650.75';
  /* 版本号是**协议里声明的 Chromium build**，不是本机浏览器的版本：
     - 成熟客户端 edge-tts 就写死 `CHROMIUM_FULL_VERSION = "143.0.3650.75"`，
       再拼 `"2-" + 版本`；发 `1-143.0.3650.75` 是版本对、**前缀旧**的混合形态，服务端不认；
     - 从 UA 抠版本不可行：现代 Edge 的 UA 是归约形态（本机 156 的 UA 尾部 `Edg/156.0.0.0`），
       抠出来是个不存在的 build；按"本机真实版本"发也不对——那不是这个参数的含义；
     - 微软要求抬版本时跟着成熟库抬，或用设置/配置里的覆盖值顶一下。
     想换成别处来的值：`BF.CONFIG.EDGE.secVer`，改这一处即可。 */
  let _secVerLogged = false;
  /* 生效版本号：设置里的覆盖 > 内置常量。 */
  function _curSecVer() {
    try { const v = BF.settings.get('edgeSecVer'); if (v) return String(v); } catch (e) {}
    return SEC_VER;
  }
  /* 第二手：浏览器真实 build（UA-CH fullVersionList）。只在握手被拒时用一次——
     微软抬版本下限时，Edge 用户能自愈；默认仍发内置常量，避免多一条不稳定路径。 */
  let _uaTried = false, _uaP = null;
  function _uaSecVer() {
    if (_uaP) return _uaP;
    _uaP = (async function () {
      try {
        const ua = navigator.userAgentData;
        if (ua && typeof ua.getHighEntropyValues === 'function') {
          const h = await Promise.race([
            ua.getHighEntropyValues(['fullVersionList']),
            new Promise(function (r) { BF.timers.timeout(function () { r(null); }, 1500); }),
          ]);
          const hit = ((h && h.fullVersionList) || []).find(function (b) { return /Edge|Edg/i.test((b && b.brand) || ''); });
          if (hit && /^\d+(\.\d+){3}$/.test(String(hit.version || ''))) return '2-' + hit.version;
        }
      } catch (e) { /* 落到 UA */ }
      const m = /Edg\/(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(navigator.userAgent || '');
      if (m && (+m[3] || +m[4])) return '2-' + m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4];
      return '';
    })();
    return _uaP;
  }
  /* 音色表 = Edge 免费通道服务端实际开放的全部 zh-CN 音色（voices/list 实测，
     2026-11-10）：共 8 个。Azure 文档里的多情感/风格音色（晓辰/晓涵/晓梦/晓睿/
     晓双/云枫/云浩/云登）不在免费通道内，选中即 1007 Unsupported voice 并断开，
     照文档抄表会踩坑；服务端扩音色时改这张表即可。 */
  const VOICES = [
    { id: 'zh-CN-XiaoxiaoNeural', display: '晓晓（女·温柔）' },
    { id: 'zh-CN-XiaoyiNeural', display: '晓伊（女·活泼）' },
    { id: 'zh-CN-YunjianNeural', display: '云健（男·浑厚）' },
    { id: 'zh-CN-YunxiNeural', display: '云希（男·阳光）' },
    { id: 'zh-CN-YunyangNeural', display: '云扬（男·新闻）' },
    { id: 'zh-CN-YunxiaNeural', display: '云夏（男·少年）' },
    { id: 'zh-CN-liaoning-XiaobeiNeural', display: '晓北（女·东北）' },
    { id: 'zh-CN-shaanxi-XiaoniNeural', display: '晓妮（女·陕西）' },
  ];
  const VOICE_IDS = VOICES.map(function (v) { return v.id; });
  function canUse() {
    /* 在线引擎需联网（wss），离线时直接不可用，让引擎选择链走降级 */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    /* 服务端要求 UA 带 Edg（其他内核连构造都对了也会被拒）。
       Sec-MS-GEC v2 是纯 JS 实现，不再依赖 crypto.subtle，file:// 也可用。 */
    try { return /Edg/i.test(navigator.userAgent); } catch (e) { return false; }
  }
  function genConnId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      const r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  /* C2 时钟偏差自愈：本机时钟偏差 >5min 是 Edge 公共通道直接 403 的
     根因（Sec-MS-GEC 按 5 分钟窗计算，偏差超窗即拒）。
     _skewMs = 服务器时间 - 本机时间（内存态，gecToken 消费）。 */
  let _skewMs = 0;
  let _skewTried = false;   /* ±窗盲重试每会话只做一次 */
  /* ===== Sec-MS-GEC v2：变体 SHA-256 + CS64 复合摘要（纯 JS 移植，无依赖） =====
     2026-10 中旬微软把 token 从 v1（标准 SHA-256(ticks+token)，上一种实现）切到 v2：
     格式 "<16hex>-<64hex>"，两段都出自一套改动过的 SHA-256——自定义 IV、
     14 项预置调度表、轮常量第 14 项被替换、sigma 合并截断，标准 SHA-256
     给不出这个值，crypto.subtle.digest 也不行，必须完整移植变体实现。
     依 edge-tts 7.3.1 drm.py 逐行移植；与 Python 参考实现对 9 组输入
     （5 组时间戳 + 短/长/边界 token）逐字符一致。乘法用 BigInt（word×key 可达 2^64，
     超出 Number 的 2^53 精确范围）；sha256 部分全是 32 位运算，Number 足够精确。 */
  const _GEC_U32 = 0xFFFFFFFF;
  function _gecRol16(v) { v &= _GEC_U32; return ((v << 16) | (v >>> 16)) & _GEC_U32; }
  function _gecRotr(v, n) { return ((v >>> n) | (v << (32 - n))) & _GEC_U32; }
  /* 变体小 sigma：合并旋转先异或、最后截一次 32 位（按位与对异或可分配，等价逐项截断） */
  function _gecSig0(v) { return ((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) & _GEC_U32; }
  function _gecSig1(v) { return ((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) & _GEC_U32; }
  const _GEC_IV  = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
  const _GEC_ST0 = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
  const _GEC_SCH = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0,
    0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
  const _GEC_KR = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
  ];
  /* 首块（模拟的「56 字节 0 + data[:7] 尾挂」块）恢复轮从第 14 轮起算，K[14] 用替换值 */
  const _GEC_KB = _GEC_KR.slice(); _GEC_KB[14] = 0xC9DC06A7;
  const _GEC_SIG0A = 0x059C0B80, _GEC_SIG1A = 0x000B92C0, _GEC_ADJ = 0xC9DC06A7;
  function _gecRounds(state, words, first, K) {
    let a = state[0], b = state[1], c = state[2], d = state[3];
    let e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = first; i < 64; i++) {
      const t1 = (h + (_gecRotr(e, 6) ^ _gecRotr(e, 11) ^ _gecRotr(e, 25)) + (g ^ (e & (f ^ g))) + K[i] + words[i]) >>> 0;
      const t2 = ((_gecRotr(a, 2) ^ _gecRotr(a, 13) ^ _gecRotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
      const na = (t1 + t2) >>> 0, ne = (d + t1) >>> 0;
      d = c; c = b; b = a; a = na;
      h = g; g = f; f = e; e = ne;
    }
    return [a, b, c, d, e, f, g, h];
  }
  function _gecExpand(w, from) {
    for (let i = from; i < 64; i++) {
      const x = w[i - 2], y = w[i - 15];
      w[i] = (_gecSig1(x) + w[i - 7] + _gecSig0(y) + w[i - 16]) >>> 0;
    }
  }
  function _gecInitState(d) {
    const w = new Array(64).fill(0);
    w[14] = ((d[0] << 16) | (d[1] << 8) | d[2]) >>> 0;
    w[15] = ((d[3] << 24) | (d[4] << 16) | (d[5] << 8) | d[6]) >>> 0;
    for (let i = 16; i <= 29; i++) {
      let v = _GEC_SCH[i - 16];
      if (i - 2 >= 14) v += (i === 16) ? (_gecSig1(w[14]) ^ _GEC_SIG1A) : _gecSig1(w[i - 2]);
      if (i - 7 >= 14) v += w[i - 7];
      if (i - 15 >= 14) v += (i === 29) ? (_gecSig0(w[i - 15]) ^ _GEC_SIG0A) : _gecSig0(w[i - 15]);
      w[i] = v >>> 0;
    }
    w[30] = (_gecSig1(w[28]) + w[23] + _gecSig0(w[15]) + w[14] + _GEC_ADJ - _GEC_KR[14]) >>> 0;
    _gecExpand(w, 31);
    const work = _gecRounds(_GEC_ST0, w, 14, _GEC_KB);
    const st = new Array(8);
    for (let i = 0; i < 8; i++) st[i] = (_GEC_IV[i] + work[i]) >>> 0;
    return st;
  }
  function _gecDigest(data) {
    const len = 57 + data.length;
    const zeros = (((55 - len) % 64) + 64) % 64;
    const body = data.length - 7;
    const total = body + 1 + zeros + 8;
    const padded = new Uint8Array(total);
    padded.set(data.subarray(7));
    padded[body] = 0x80;
    const bits = len * 8;
    const hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
    padded[total - 8] = (hi >>> 24) & 0xFF;
    padded[total - 7] = (hi >>> 16) & 0xFF;
    padded[total - 6] = (hi >>> 8) & 0xFF;
    padded[total - 5] = hi & 0xFF;
    padded[total - 4] = (lo >>> 24) & 0xFF;
    padded[total - 3] = (lo >>> 16) & 0xFF;
    padded[total - 2] = (lo >>> 8) & 0xFF;
    padded[total - 1] = lo & 0xFF;
    let st = _gecInitState(data.subarray(0, 7));
    for (let off = 0; off + 64 <= total; off += 64) {
      const w = new Array(16);
      for (let i = 0; i < 16; i++) {
        w[i] = ((padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3]) >>> 0;
      }
      _gecExpand(w, 16);
      const work = _gecRounds(st, w, 0, _GEC_KR);
      for (let i = 0; i < 8; i++) st[i] = (st[i] + work[i]) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = st[i] >>> 24; out[i * 4 + 1] = (st[i] >>> 16) & 0xFF;
      out[i * 4 + 2] = (st[i] >>> 8) & 0xFF; out[i * 4 + 3] = st[i] & 0xFF;
    }
    return out;
  }
  function _gecCs64(data, digest) {
    const M = 0xFFFFFFFFn;
    const rol = (v) => ((v & M) << 16n | (v >> 16n)) & M;
    const keyA = BigInt(((digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) >>> 0)) | 1n;
    const keyB = BigInt(((digest[4] | (digest[5] << 8) | (digest[6] << 16) | (digest[7] << 24)) >>> 0)) | 1n;
    const FACT = 0x82893933n;
    const fA = keyA * FACT & M, fB = keyB * FACT & M;
    const COEF = [
      0xE82E91B1, 0xB32700D0, 0x44DE24C6, 0x88DFF51D, 0x3BEB65BC, 0x29514038,
      0xC89C5933, 0xB328CBDF, 0x8D1EC211, 0xD405B4D5, 0x314EF5D5, 0x26E55F3C,
      0xE92491B1, 0x607801C6, 0xF0A5B9D5, 0x82B2C1FB, 0x06064CF3, 0xFA51A3DA,
      0xDA79FA60, 0x207CC464, 0xBED20560, 0x3C3C74F3, 0x89F9C9F8, 0xD2D14B61,
      0x35FA38C6, 0xBB04A2C1, 0xCB49E3C6, 0xC5626167,
    ];
    const terms = [], offs = [];
    for (let i = 0; i < 14; i++) {
      terms.push(BigInt(COEF[2 * i]) * (i % 2 ? fB : fA) & M);
      offs.push(BigInt(COEF[2 * i + 1]));
    }
    /* 0x00 前缀 + LE 4 字节切词：先补到 4 的倍数，词数为奇再补一词（_words_le4_even） */
    let bl = data.length + 1;
    bl += (4 - (bl % 4)) % 4;
    if ((bl >> 2) & 1) bl += 4;
    const buf = new Uint8Array(bl);
    buf[0] = 0; buf.set(data, 1);
    const nw = bl >> 2;
    for (let i = 0; i < nw; i++) {
      const w = BigInt(((buf[i * 4] | (buf[i * 4 + 1] << 8) | (buf[i * 4 + 2] << 16) | (buf[i * 4 + 3] << 24)) >>> 0));
      const k = (i % 2 === 0) ? keyA : keyB;
      let term = w * k;
      let off = rol(w) * BigInt(i % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
      if (i === 0) { term += 0xF2F90B1An * fA; off += 0x0B1A0000n; }
      terms.push(term & M);
      offs.push(off & M);
    }
    let swapAcc = 0n, swapLast = 0n, st = 0n, acc = 0n;
    for (let i = 0; i < terms.length; i += 2) {
      const x = terms[i], y = terms[i + 1];
      let t = rol((offs[i] + x) & M);
      let q = t * 0x76F50F34n & M;
      swapAcc = (swapAcc + ((rol(q) * 0xC3EFEA97n + q) & M)) & M;
      t = rol((offs[i + 1] + y) & M);
      q = t * 0x1881CE3Cn & M;
      swapLast = (rol(q) * 0x35BD1EC9n + q) & M;
      swapAcc = (swapAcc + swapLast) & M;

      st = (st * keyA + x) & M;
      st = rol(st) * 0xCF98B111n & M;
      st = rol(st) * 0x87085B9Fn & M;
      st = rol(st) * 0x12CEB96Dn & M;
      st = rol(st) * 0x257E1D83n & M;
      acc += st;
      let tt = (st * keyB + y) & M;
      tt = rol(tt) * 0xA27416F5n & M;
      tt = rol(tt) * 0xD38396FFn & M;
      st = rol(rol(tt) * 0x7C932B89n & M) * 0xBFA49F69n & M;
      acc = (acc + st) & M;
    }
    return [Number(swapLast ^ st) >>> 0, Number(swapAcc ^ acc) >>> 0];
  }
  function _gecV2(dataStr) {
    const enc = new TextEncoder().encode(dataStr);
    const dig = _gecDigest(enc);
    const cs = _gecCs64(enc, dig);
    const hex32 = (n) => {
      let s = '';
      for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xFF).toString(16).padStart(2, '0');
      return s.toUpperCase();
    };
    let dh = '';
    for (let i = 0; i < 32; i++) dh += dig[i].toString(16).padStart(2, '0');
    return hex32(cs[0]) + hex32(cs[1]) + '-' + dh.toUpperCase();
  }
  async function gecToken() {
    const ts = Math.floor((Date.now() + _skewMs) / 300000) * 300000;
    /* (ts_ms + WIN_EPOCH_MS)×10^4 是 16 的倍数、落在 Binary64 间距内，
       Number 表示精确，字符串化与 Python 参考 f"{ticks:.0f}" 同一串数字。 */
    return _gecV2(String((ts + 11644473600000) * 10000) + edgeToken());
  }
  /* 连接级探针（零常驻定时器，只在用户点「测一次连接」或合成真失败后跑）：
     只建立一次 WebSocket，不发正文、不发 SSML。
     为什么不用 HTTP GET 探：这条 URL 的普通 GET 恒回 404，能落地不代表能升级；
     14 种构造形态下 WS 升级全部被 403 拒掉，而 no-cors 的 GET 会把这种拒绝
     报成「可达」——只有真的走一次握手，结论才对得上朗读时实际会发生的事。
     时钟偏差另说：Date 响应头在 JS 侧读不到（非 CORS 安全头），
     所以 synthesize 里改成按 ±1 窗盲重试，这里不再谎称能算出偏差。 */
  function probeConnect() {
    if (!canUse()) return Promise.resolve({ ok: false, reason: '当前浏览器不支持 Edge 语音通道' });
    return gecToken().then(function (gec) {
      const url = wsBase() + '?TrustedClientToken=' + edgeToken() + '&ConnectionId=' + genConnId() + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + _curSecVer();
      return new Promise(function (resolve) {
        let ws;
        try { ws = new WebSocket(url); } catch (e) { resolve({ ok: false, reason: String((e && e.message) || e) }); return; }
        let settled = false;
        const t0 = Date.now();
        const timer = BF.timers.timeout(function () { finish({ ok: false, reason: '握手超时', timedOut: true, ms: Date.now() - t0 }); }, 8000);
        function finish(r) {
          if (settled) return;
          settled = true;
          timer();
          try { ws.close(); } catch (e) {}
          resolve(r);
        }
        ws.onopen = function () { finish({ ok: true, reason: '握手成功', ms: Date.now() - t0 }); };
        ws.onerror = function () { finish({ ok: false, reason: '握手失败（连接被拒）', refused: true, ms: Date.now() - t0 }); };
        ws.onclose = function (ev) { finish({ ok: false, reason: '服务端关闭 ' + ev.code + (ev.reason ? '：' + ev.reason : ''), closed: true, ms: Date.now() - t0 }); };
      });
    });
  }
  /* Edge 单连接复用。朗读是逐句串行的，一章可能数百句——
     每句新建一条 WebSocket 握手（500 句=500 次握手），是延迟与限流最大单点。
     做法：按 音色 缓存一条长连接，在 GEC 窗口内复用；连接上一条请求在途（conn._cur），
     其余排队（_edgeQ）串行发出，每条 SSML 用独立 X-RequestId，帧按号路由；
     任一失败/断开即弃连接，下次请求重新握手（含 skew 重试路径，gec 变了即开新连接）。
     本机端点 14/14 全 403（环境策略拒绝），无法对真端点验证；
     连接身份化、队列串行、reqId 过滤、取消、截断判定这几条用
     本地 mock 服务端（零依赖）配合页面内探针验过，不依赖微软。 */
  let _edgeConn = null;            /* 复用的长连接：{ ws, voice, gec, connId, expiresAt, _cur } */
  let _edgeOpening = null;         /* 并发握手去重：预取与当前句同时到，只握一次 */
  const _edgeQ = [];               /* 待发请求队列：单槽会被后一个请求覆盖，前一个只能等满 30s 超时 */
  let _gecCache = { v: '', win: -1 };
  /* 关闭必须认身份：旧 socket 的 onclose 回调若关的是"当下那条连接"，
     换音色与 skew 重试就会把刚建好的新连接一起关掉——随机断流的一条实路。 */
  function _edgeDrop(conn) {
    const c = (conn === undefined) ? _edgeConn : conn;
    if (!c) return;
    try { if (c.ws && c.ws.readyState < 2) c.ws.close(); } catch (e) {}
    if (_edgeConn === c) _edgeConn = null;
  }
  function _edgeAbortErr() {
    const e = BF.tts.stab.mkErr('D', 'EdgeTTS 请求已取消');
    try { e.name = 'AbortError'; } catch (er) {}
    return e;
  }
  /* 队列推进：只在连接活着且没有在途请求时发下一条。 */
  function _edgePump() {
    const conn = _edgeConn;
    if (!conn || !conn.ws || conn.ws.readyState !== 1 || conn._cur) return;
    while (_edgeQ.length) {
      const job = _edgeQ.shift();
      if (job.cancelled || job._done) { continue; }   /* 排队期间被取消的，不占发送位也不留坑 */
      conn._cur = job;
      try { job.send(); } catch (e) { _edgeFail(conn, job, 'EdgeTTS 发送失败', BF.tts.stab.mkErr('C', 'EdgeTTS 发送失败')); return; }
      return;
    }
  }
  /* 连接没了就把队列整个结掉。留着就等于让调用方（预取与播放链）永远等一个
     再也不会被 pump 的 Promise——挂死比报错难查得多。 */
  function _edgeDrainQueue(makeErr) {
    while (_edgeQ.length) {
      const job = _edgeQ.shift();
      if (job._done) continue;
      job._done = true;
      try { job.reject(makeErr ? makeErr() : BF.tts.stab.mkErr('C', 'EdgeTTS 连接已关闭')); } catch (e) {}
    }
  }
  /* 零音频（或服务端带着拒绝理由收尾）的归一错误。why = {code, reason}；
     err.raw 只放状态码白名单——WS 的 reason 是纯文本、无凭据，但只留截断摘要。 */
  function _edgeCloseInfo(why) {
    if (!why) return { code: 0, reason: '' };
    const c = Number(why.code) || 0;
    let rs = '';
    try { rs = why.reason == null ? '' : String(why.reason); } catch (e) { rs = ''; }
    if (rs.length > 200) rs = rs.slice(0, 200);
    return { code: c, reason: rs };
  }
  function _edgeZeroAudioErr(why) {
    const ci = _edgeCloseInfo(why);
    /* 服务端点名音色不支持：配置问题不是凭据问题——归 F（无可用能力），换音色即用。 */
    if (/unsupported voice|voice .*not supported|不支持该音色|音色.*不支持/i.test(ci.reason)) {
      const e2 = BF.tts.stab.mkErr('F', '音色不被服务端支持，请换一个音色');
      e2.raw = { status: ci.code || 1007, retryAfter: null, reason: ci.reason };
      return e2;
    }
    /* 零音频不是握手/协议失败：纯标点、内容被过滤、空句都会让服务端正常收尾但不给字节。
       归 F（无可用能力，T4）——不重试、不进黑表，也不进 C 的握手自愈链（白跑三轮还把
       「这句没声」说成凭据被拒、引导用户去换 Token）。 */
    const e = BF.tts.stab.mkErr('F', ci.reason
      ? ('EdgeTTS 未返回音频（服务端关闭：' + ci.reason + '）')
      : 'EdgeTTS 未返回音频（零音频，不谎报成功）', { status: ci.code || 0 });
    e.raw.reason = ci.reason;
    return e;
  }
  /* 句/词时间轴（本会话内存，不落盘）：键是发给服务端的朗读文本。
     只在本次会话有效——音频缓存默认关，时间轴也就没必要跨会话存。 */
  const _tl = new Map();
  const _TL_MAX = 64;
  function _tlPut(text, meta) {
    if (!text || !meta || (!meta.words.length && !meta.sents.length)) return;
    _tl.delete(text); _tl.set(text, meta);
    if (_tl.size > _TL_MAX) { const k = _tl.keys().next().value; _tl.delete(k); }
  }
  function timelineFor(text) { return _tl.get(String(text == null ? '' : text)) || null; }
  /* audio.metadata 帧：JSON 载荷，Offset/Duration 单位是 100ns（÷10000 = ms）。
     坏一帧只丢这一帧并记一次错，不打断整句音频，也不每帧刷日志。 */
  function _edgeTakeMeta(rec, bytes) {
    try {
      const j = JSON.parse(new TextDecoder().decode(bytes));
      const arr = (j && j.Metadata) || [];
      let words = null, sents = null;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i]; const d = (it && it.Data) || {};
        const ms = Math.round((+d.Offset || 0) / 10000);
        const dur = Math.round((+d.Duration || 0) / 10000);
        const txt = (d.text && (d.text.Text || d.text)) || '';
        if (it && it.Type === 'WordBoundary') (words || (words = [])).push({ ms: ms, dur: dur, txt: String(txt) });
        else if (it && it.Type === 'SentenceBoundary') (sents || (sents = [])).push({ ms: ms, dur: dur, txt: String(txt) });
      }
      /* 一个认得的边界都没有就不建对象：空载荷不该让时间轴表里多一条空记录 */
      if (!words && !sents) return;
      if (!rec.meta) rec.meta = { words: [], sents: [] };
      if (words) rec.meta.words.push.apply(rec.meta.words, words);
      if (sents) rec.meta.sents.push.apply(rec.meta.sents, sents);
    } catch (e) {
      if (!rec._metaErr) { rec._metaErr = true; try { BF.err.report('tts.metadata', e); } catch (e2) {} }
    }
  }
  /* 收尾（turn.end 或连接关闭）的音频判定：零音频绝不 resolve 空 Blob；
     服务端带拒绝理由收尾以理由定性优先。完成即释放 _cur，连接保留复用。 */
  function _edgeFinish(conn, rec, why) {
    if (rec._done) return; rec._done = true; if (rec.timer) rec.timer();
    if (rec.meta) _tlPut(rec.text, rec.meta);
    const blob = new Blob(rec.chunks, { type: 'audio/mpeg' });
    if (conn && conn._cur === rec) conn._cur = null;
    if (!rec.chunks.length) { rec.reject(_edgeZeroAudioErr(why)); _edgePump(); return; }
    rec.resolve(blob);
    _edgePump();
  }
  function _edgeFail(conn, rec, msg, err) {
    if (rec._done) return; rec._done = true; if (rec.timer) rec.timer();
    if (conn && conn._cur === rec) conn._cur = null;
    try { _edgeDrop(conn); } catch (e) {}
    /* 连接作废后，排在它后面的请求再也不会被发出：一起结掉，别留悬着的 Promise。 */
    _edgeDrainQueue(function () { return err || BF.tts.stab.mkErr('C', msg); });
    rec.reject(err || new Error(msg));
  }
  function _edgeRejectVoice(conn, rec, rc, rs) {
    if (rec._done) return; rec._done = true; if (rec.timer) rec.timer();
    rec.reject(_edgeZeroAudioErr({ code: rc, reason: rs }));
  }
  /* 帧归属：Edge 在每一帧的头里都带 X-RequestId。带得出来就必须对上号才收——
     对不上号的是上一句的迟到帧，直接收下就会拼进下一句的音频里（跨句串音）。
     帧头带不出 reqId 的形态维持旧行为（交给当前请求），免得某个形态少带时把音频全丢光。 */
  function _edgeHeadReqId(hdr) {
    const m = /X-RequestId:\s*([0-9a-fA-F-]{12,})/.exec(String(hdr == null ? '' : hdr));
    return m ? m[1] : '';
  }
  function _edgeTargetRec(conn, rid) {
    const cur = conn && conn._cur;
    if (!cur || cur._done) return null;
    return (!rid || rid === cur.reqId) ? cur : null;
  }
  /* 看门狗：每请求 30s 硬顶，但收到任何帧就重置——慢但持续返回的合法长句不再被误杀。 */
  function _edgeResetTimer(rec, conn) {
    if (!rec || rec._done) return;
    if (rec.timer) { try { rec.timer(); } catch (e) {} }
    rec.timer = BF.timers.timeout(function () { _edgeFail(conn, rec, 'EdgeTTS 超时（30s）', BF.tts.stab.mkErr('D', 'EdgeTTS 超时（30s）')); }, 30000);
  }
  /* 单帧解析（原 onmessage 帧逻辑原样保留）：只收纯音频帧，排除 audio.metadata。 */
  function _edgeOnFrame(conn, data) {
    const buf = new Uint8Array(data);
    if (buf.length <= 8) return;
    let hdr = '', start = -1;
    /* 候选头长布局（真实帧 p=2 与既有测试桩 p=6 并存）：先按 [0..1] 大端（真实帧），
       再按 [2..5] 大端（桩）。每个候选都要自洽——Path: 标记须落在头部范围内且
       start<=帧长，否则下一个候选，避免在 MP3 载荷里误命中 "Path" 四字节。 */
    const cands = [[2, (buf[0] << 8) | buf[1]], [6, (buf[2] << 24 >>> 0) + (buf[3] << 16) + (buf[4] << 8) + buf[5]]];
    for (let ci = 0; ci < cands.length; ci++) {
      const p = cands[ci][0], headerLen = cands[ci][1];
      if (headerLen <= 0 || p + headerLen > buf.length) continue;
      let h = '';
      try { h = new TextDecoder().decode(buf.subarray(p, p + headerLen)); } catch (e) { continue; }
      if (h.indexOf('Path:') === -1) continue;
      hdr = h; start = p + headerLen; break;
    }
    if (start > 0) {
      const rec = _edgeTargetRec(conn, _edgeHeadReqId(hdr));
      if (!rec) return;
      _edgeResetTimer(rec, conn);   /* 收到帧即重置看门狗，慢但持续的合法长句不再被判失败 */
      const pi = hdr.lastIndexOf('Path:');
      const path = pi >= 0 ? hdr.slice(pi) : '';
      /* 词/句边界帧：服务端随音频一起发，之前整帧被丢掉（只收纯音频）。
         现在分流给时间轴，音频帧照旧。 */
      if (path.indexOf('Path:audio.metadata') === 0) { _edgeTakeMeta(rec, buf.subarray(start)); return; }
      if (path.indexOf('Path:audio') === 0) {
        if (start < buf.length) rec.chunks.push(buf.subarray(start));
      }
    }
  }
  async function _edgeOpen(voice, gec, winEnd, secVer, wantTl) {
    const connId = genConnId();
    const _sv = secVer || _curSecVer();
    if (!_secVerLogged) {
      _secVerLogged = true;
      BF.log && BF.log.info('Edge 语音版本号：' + _sv);
    }
    const url = wsBase() + '?TrustedClientToken=' + edgeToken() + '&ConnectionId=' + connId + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=' + _sv;
    const ws = await new Promise(function (resolve, reject) {
      let s;
      let settled = false;
      let timer = null;
      const done = function (fn, v) { if (settled) return; settled = true; if (timer) { try { timer(); } catch (e) {} } fn(v); };
      try { s = new WebSocket(url); } catch (e) { reject(e); return; }
      s.binaryType = 'arraybuffer';
      /* 握手必须有上限：网络黑洞或服务端不响应时，onopen/onerror/onclose 一个都不来，
         这个 Promise 永不落地，并发去重锁 _edgeOpening 也就永不释放 ——
         之后每次朗读都复用这口死井，只能刷新页面。探测口早就有 8s 上限，这里对齐。 */
      timer = BF.timers.timeout(function () {
        try { s.close(); } catch (e) {}
        done(reject, BF.tts.stab.mkErr('C', 'EdgeTTS 握手超时（8s）'));
      }, 8000);
      s.onopen = function () { done(resolve, s); };
      s.onerror = function () { done(reject, BF.tts.stab.mkErr('C', 'EdgeTTS 握手失败')); };
      s.onclose = function () { done(reject, BF.tts.stab.mkErr('C', 'EdgeTTS 连接被提前关闭')); };
    });
    /* 有效期认 GEC 窗结束（留 5s 余量），不写死 290s：写死的数与真实窗口错位时，
       会拿着过期凭据继续复用同一条连接，现象是"听几句突然全断"而不是报错。 */
    const conn = { ws: ws, voice: voice, gec: gec, secVer: _sv, connId: connId, expiresAt: (winEnd || (Date.now() + 290000)) - 5000, tl: !!wantTl, _cur: null };
    /* 连接级处理：帧按 X-RequestId 路由到在途请求；断开只作废"自己这条"连接。 */
    ws.onerror = function () {
      try { if (conn._cur && !conn._cur._done) _edgeFail(conn, conn._cur, 'EdgeTTS 连接失败', BF.tts.stab.mkErr('D', 'EdgeTTS 连接中途失败')); } catch (e) {}
      _edgeDrop(conn);
    };
    ws.onclose = function (ev) {
      const rc = (ev && ev.code) || 0;
      const rs = (function () { try { const r = ev && ev.reason; return r == null ? '' : String(r); } catch (e) { return ''; } })();
      if (/unsupported voice|voice .*not supported|不支持该音色|音色.*不支持/i.test(rs)) {
        try { if (conn._cur && !conn._cur._done) _edgeRejectVoice(conn, conn._cur, rc, rs); } catch (e) {}
      } else {
        /* 已建立连接后中途断开：必须走 mkErr 带上分类码。给裸 Error 的话
           synthesize 的 catch 认不出分类，会把它当成握手被拒——先盲试两窗偏差、
           再跑一次连通探针，最后报「连接被服务端拒绝」。三次请求换一句错话。 */
        try { if (conn._cur && !conn._cur._done) _edgeFail(conn, conn._cur, 'EdgeTTS 关闭' + (rs ? '：' + rs : ''), BF.tts.stab.mkErr('D', 'EdgeTTS 连接中途断开' + (rs ? '：' + rs : ''))); } catch (e) {}
      }
      /* 在途请求以外、还排在这条连接上的请求也一并结掉，否则它们永远悬着。
         分类给 D（瞬时）而不是 C：连接断掉不等于这个引擎不可用，
         按 C 处理会把它关进 15 分钟黑表。 */
      _edgeDrainQueue(function () { return BF.tts.stab.mkErr('D', 'EdgeTTS 连接已关闭' + (rs ? '：' + rs : '')); });
      _edgeDrop(conn);
    };
    ws.onmessage = function (ev) {
      try {
        if (typeof ev.data === 'string') {
          /* 文本帧两类：turn.end（服务端说完这句）与 audio.metadata（词/句边界）。
             头部止于 \r\n\r\n，载荷 JSON 里若含 "Path:" 字样不算数，先切头再取标记。
             turn.end 由 _edgeFinish 统一判零音频；连接复用下 turn.end 只结束它自己那句。 */
          const s = ev.data;
          const bi = s.indexOf('\r\n\r\n');
          const head = bi >= 0 ? s.slice(0, bi) : s;
          const pi = head.lastIndexOf('Path:');
          if (pi < 0) return;
          const path = head.slice(pi);
          const rec = _edgeTargetRec(conn, _edgeHeadReqId(head));
          if (!rec) return;
          if (path.indexOf('Path:turn.end') === 0) { _edgeFinish(conn, rec, { code: 0, reason: '' }); return; }
          if (path.indexOf('Path:audio.metadata') === 0) {
            _edgeResetTimer(rec, conn);
            if (bi >= 0) _edgeTakeMeta(rec, new TextEncoder().encode(s.slice(bi + 4)));
          }
          return;
        }
        _edgeOnFrame(conn, ev.data);
      } catch (e) { BF.err.report('tts.edge.frame', e); }
    };
    /* 连接级 speech.config（一次）；wantTl 由 _edgeAcquire 读好传进来，与复用键同一来源。
       开关打开时同时要句边界与词边界。 */
    const secMsg = 'Path:speech.config\r\nX-Timestamp:' + new Date().toISOString() + '\r\nContent-Type:application/json; charset=utf-8\r\n\r\n' +
      JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: (wantTl ? 'true' : 'false'), wordBoundaryEnabled: (wantTl ? 'true' : 'false') }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } });
    try { ws.send(secMsg); } catch (e) { _edgeDrop(conn); throw BF.tts.stab.mkErr('C', 'EdgeTTS 配置发送失败'); }
    _edgeConn = conn;
    return conn;
  }
  /* GEC 是「5 分钟窗 + token」的 SHA-256：同一个窗里每句各算一遍是白算，值必然一样。
     缓存键取窗口号——_skewMs 变了窗口号跟着变，不会把纠偏前的旧值拿来用。 */
  async function gecCached() {
    const win = Math.floor((Date.now() + _skewMs) / 300000);
    if (_gecCache.win === win && _gecCache.v) return _gecCache;
    _gecCache = { v: await gecToken(), win: win };
    return _gecCache;
  }
  async function _edgeAcquire(voice, secVerOverride) {
    const g = await gecCached();
    const _wantSec = secVerOverride || _curSecVer();
    /* 时间轴开关进复用键：metadataoptions 只在握手时发一次，开关中途切换后
       同连接的后续句子照样不产边界，要等换音色或 GEC 窗口过期才生效。 */
    const _wantTl = !!BF.settings.get('ttsSentenceBoundary');
    const reusable = function (c) {
      return !!(c && c.ws && c.ws.readyState === 1 && c.voice === voice && c.gec === g.v && c.secVer === _wantSec && c.tl === _wantTl && Date.now() < c.expiresAt);
    };
    if (reusable(_edgeConn)) return _edgeConn;
    /* 已在握手就不再开第二条：预取与当前句同时到达时各开一条再互相关掉，
       等于退回逐句握手还多烧一条连接。 */
    if (_edgeOpening) {
      try { await _edgeOpening; } catch (e) {}
      if (reusable(_edgeConn)) return _edgeConn;
    }
    _edgeDrop(_edgeConn);
    _edgeOpening = _edgeOpen(voice, g.v, (g.win + 1) * 300000 - _skewMs, _wantSec, _wantTl);
    try { return await _edgeOpening; } finally { _edgeOpening = null; }
  }
  /* SSML prosody：语速/音调交给服务端，音量不在这里乘——播放链上的 gain 才是
     用户那格音量，两边各乘一遍会让默认 0.9 实际出声 0.81，切到 Edge 比离线档小一截。 */
  function _edgeSsml(text, voice) {
    const r = BF.settings.num('ttsRate', 1);
    const p = BF.settings.num('ttsPitch', 1);
    const rateS = (r === 1) ? '+0%' : ((r < 1 ? '-' : '+') + Math.round(Math.abs(r - 1) * 100) + '%');
    const pitchS = (p === 1) ? 'default' : ((p < 1 ? '-' : '+') + Math.round(Math.abs(p - 1) * 100) + '%');
    return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="' + voice + '">' +
      '<prosody rate="' + rateS + '" pitch="' + pitchS + '" volume="100">' +
      String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') +
      '</prosody></voice></speak>';
  }
  async function _synthesizeOnce(text, voiceId, opts) {
    if (!canUse()) throw BF.tts.stab.mkErr('F', 'EdgeTTS 需要 Edge 浏览器');
    let voice = voiceId || BF.settings.get('ttsEdgeVoice') || 'zh-CN-XiaoxiaoNeural';
    /* 旧存档可能留着服务端已下线的音色（2026-11 音色表普查删了 8 个）：
       不在表内一律回落晓晓，避免必然触发的 1007。 */
    if (VOICE_IDS.indexOf(voice) < 0) voice = 'zh-CN-XiaoxiaoNeural';
    const signal = opts && opts.signal;
    const ssml = _edgeSsml(text, voice);
    /* 复用同音色长连接（GEC 窗口内），消除逐句握手。失败/断开由 _edgeAcquire 重建。 */
    const conn = await _edgeAcquire(voice, opts && opts.secVer);
    return new Promise(function (resolve, reject) {
      const job = {
        reqId: genConnId(), chunks: [], _done: false, cancelled: false, conn: conn,
        resolve: resolve, reject: reject, timer: null, text: text, meta: null,
        /* 发送放在 pump 里：排在队里的请求不占 30s 计时，
           否则前面那句一慢，后面排队的还没发就先被自己的超时判死。 */
        send: function () {
          _edgeResetTimer(job, conn);
          conn.ws.send('Path:ssml\r\nX-RequestId:' + job.reqId + '\r\nX-Timestamp:' + new Date().toISOString() + '\r\nContent-Type:application/ssml+xml\r\n\r\n' + ssml);
        },
      };
      const cancel = function () {
        job.cancelled = true;
        const i = _edgeQ.indexOf(job);
        if (i >= 0) { _edgeQ.splice(i, 1); job._done = true; reject(_edgeAbortErr()); return; }
        if (conn._cur === job) { _edgeFail(conn, job, 'EdgeTTS 请求已取消', _edgeAbortErr()); return; }
        if (!job._done) { job._done = true; reject(_edgeAbortErr()); }
      };
      if (signal) {
        if (signal.aborted) { cancel(); return; }
        try { signal.addEventListener('abort', cancel, { once: true }); } catch (e) {}
      }
      _edgeQ.push(job);
      _edgePump();
    });
  }
  async function synthesize(text, voiceId, opts) {
    if (!canUse()) throw BF.tts.stab.mkErr('F', 'EdgeTTS 需要 Edge 浏览器');
    /* 在线通道被真用过一次 —— 体检模块的首探资格以此为准（见 BF.tts.health）。
       放在这里而不是播放层，是因为选区朗读、预合成和体检探针都从这里走。 */
    try { if (BF.tts.health) BF.tts.health.noteOnlineAttempt(); } catch (e) {}
    try {
      return await _synthesizeOnce(text, voiceId, opts);
    } catch (e) {
      /* C 类（握手被拒，含版本号/时钟偏差引起的 403）必须继续走下面的自愈链；
         其余已分类错误与被取消的照旧直接上抛。 */
      if (e && (e.__bfCancelled || (e.code && e.code !== 'C'))) throw e;
      /* 第二手：握手被拒时，用浏览器真实 build 再试一次（每会话一次）。
         内置版本号被微软抬上去之后，Edge 用户不必等发版就能自愈。 */
      if (!_uaTried) {
        _uaTried = true;
        try {
          const uaSec = await _uaSecVer();
          if (uaSec && uaSec !== _curSecVer()) {
            const again0 = await _synthesizeOnce(text, voiceId, Object.assign({}, opts, { secVer: uaSec }));
            BF.log.info('Edge 版本号自愈命中：改用浏览器真实版本 ' + uaSec);
            return again0;
          }
        } catch (e0) { /* 没成就落到下面的时钟偏差盲试 */ }
      }
      /* C2 时钟偏差自愈：Sec-MS-GEC 按 5 分钟窗取整计算，本机时钟跑偏超过一窗就是 403。
         真实偏差算不出来（Date 头在 JS 侧读不到），所以按 ±1 窗各盲试一次：
         偏差恰为一窗整数倍时能命中，命中即恢复；不命中只多两次握手。
         每会话一次（_skewTried），不把它变成重试风暴。 */
      if (!_skewTried) {
        _skewTried = true;
        for (const delta of [300000, -300000]) {
          _skewMs = delta;
          _gecCache = { v: '', win: -1 };   /* 纠偏后窗口号变了，缓存必须作废 */
          try {
            const again = await _synthesizeOnce(text, voiceId, opts);
            BF.log.info('Edge 时钟偏差自愈命中：窗偏移 ' + Math.round(delta / 1000) + 's 后可用（本机时钟可能与服务器不一致）');
            return again;
          } catch (e2) { /* 换下一个偏移再试 */ }
        }
        _skewMs = 0;
        _gecCache = { v: '', win: -1 };
      }
      /* 探针与正式路径同构造：真 403 时它必然同样被拒，「探针通 ⇒ 凭据问题」
         这条分支在同构造下不可达，删掉。探针只剩时序价值：超时 = 网络黑洞/出口被拦，
         报 A/D；其余秒拒形态在浏览器侧同形（403 与 DNS/RST 都触发 onerror），
         保守报 D（T1 重试两轮）——报 B 会拉黑 900s 还引导换 Token，断网时那句引导是害的。 */
      const p = await probeConnect();
      if (p.timedOut) throw BF.tts.stab.mkErr(BF.tts.stab.offlineNow() ? 'A' : 'D', 'EdgeTTS 连接超时：' + (p.reason || '网络不可达'));
      throw BF.tts.stab.mkErr('D', 'EdgeTTS 连接失败：' + (p.reason || '网络不可达'));
    }
  }
  /* 停止/切章/换书：在途与排队的一次结掉并弃连接。播放层有自己的代次判据（_pfEpoch），
     但 WS 请求不受它管——不停手就会在用户按暂停后继续把整章句子发往服务端。 */
  function cancelAll() {
    const err = function () { const e = _edgeAbortErr(); e.__bfCancelled = true; return e; };
    const conn = _edgeConn;
    if (conn && conn._cur && !conn._cur._done) {
      try { _edgeFail(conn, conn._cur, 'EdgeTTS 请求已取消', err()); } catch (e) {}
    } else {
      _edgeDrainQueue(err);
      _edgeDrop(conn);
    }
  }
  return { VOICES, canUse, synthesize, probeConnect, cancelAll, skewMs: skewMs, wsBase: wsBase, timelineFor: timelineFor, gec: gec };
  /* 自检（BF.tts.health）的只读入口：
     skewMs —— 本会话生效的时钟窗偏移；wsBase —— 当前生效端点（迁移覆盖已摘除，恒为内置）；
     gec —— 自检探针借用的 v2 令牌，与正式朗读同一份计算，探针不得另算一份。
     时钟偏移不对外提供 setter：能算准的通路不存在（跨源读不到 Date 头），
     盲试自己在 synthesizeWithRetry 里就能做，外部注入反而会把 _skewTried 的每会话一次绕开。 */
  function skewMs() { return _skewMs; }
  function wsBase() { return WS_BASE; }
  function gec() { return gecCached().then(function (g) { return g.v; }); }
})();

