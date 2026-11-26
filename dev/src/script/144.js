/* ================= Worker 线程池（大文件分章离线计算） =================
   仅对 >512KB 的文本走 Worker，避免正则分章阻塞主线程；小文件与不支持环境回退同步分章。
   Worker 源码经 .toString() 注入主线程同一份分章核心（cleanText/_splitBounds/
   _buildChapters/_regexRisk），单实现双调用，且大书路径也先跑 cleanText，
   结果天然一致；回溯防护（_regexRisk）也随之覆盖 Worker 路径。 */
BF.workerPool = (function () {
  /* Worker 按 op 分池，不是单实例串行：
     ① 全部 op 共用一个 Worker 时，导入大书会时分章/压缩/搜索互相排队
     ② onerror reject 了 pending 但 _worker 不置 null，之后 postMessage 进死 Worker 永久 pending
     ③ 任务无超时、pending 无上限，卡死会一直挂着。
     因此：分池 + 死亡自愈 + 请求超时 + pending 上限。 */
  var _pool = {};            /* op → {w, dead} */
  var _url = null, _seq = 0, _pending = {};
  var TASK_TIMEOUT = BF.CONFIG.WORKER_TASK_TIMEOUT; /* 单任务超时（压缩大文本可能较慢，取 60s） */
  var MAX_PENDING = BF.CONFIG.WORKER_MAX_PENDING;   /* pending 上限，超出直接拒绝，防无限堆积 */
  var POOL_OPS = ['split', 'compress', 'decompress', 'search'];
  function _workerSrc() {
    /* 分章唯一实现：Worker 复用主线程 BF.library 的核心函数源码
       （cleanText / _splitBounds / _buildChapters 经 .toString() 注入），
       两处不分叉，且大书路径也先跑 cleanText。 */
    var reSrc = String(BF.library.RE_CHAPTER);
    var coreSrc = [
      'var cleanText = ' + BF.library.cleanText.toString() + ';',
      'var _splitBounds = ' + BF.library._splitBounds.toString() + ';',
      'var _buildChapters = ' + BF.library._buildChapters.toString() + ';',
      /* 回溯静态检测器与分章核心同源注入（_splitBounds 内部调用它），
         保证 Worker 路径与主线程同一把尺，不造第二份副本。 */
      'var _regexRisk = ' + _regexRisk.toString() + ';',
    ].join('\n');
    var splitWrap = 'function split(text,o){var t=cleanText(text);var b=_splitBounds(t,o);if(!(b[0]===0&&b[b.length-1]===t.length)){return [{title:"\\u6b63\\u6587",content:t.trim()}];}return _buildChapters(t,b,o);}';
    return [
      'var RE_CHAPTER = ' + reSrc + ';',
      coreSrc,
      splitWrap,
      'function b2a(u8){var s="";var CH=0x8000;for(var i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}',
      'function a2b(b){var s=atob(b);var o=new Uint8Array(s.length);for(var i=0;i<s.length;i++)o[i]=s.charCodeAt(i);return o;}',
      'async function gz(text){var cs=new CompressionStream("gzip");var blob=await new Response(new Blob([text]).stream().pipeThrough(cs)).blob();return "gz1:"+b2a(new Uint8Array(await blob.arrayBuffer()));}',
      'async function ugz(s){var bin=atob(s.slice(4));var u8=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);var ds=new DecompressionStream("gzip");return await new Response(new Blob([u8]).stream().pipeThrough(ds)).text();}',
      'function _fold(s){var r="";for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c>=0xFF01&&c<=0xFF5E)c-=0xFEE0;else if(c===0x3000)c=0x20;if(c>=65&&c<=90)c+=32;r+=String.fromCharCode(c);}return r;}function search(text,q){var out=[];if(!text||!q)return out;var tn=_fold(text),qn=_fold(q);var pos=0,count=0;while((pos=tn.indexOf(qn,pos))!==-1&&count<20){var start=Math.max(0,pos-20);out.push({pos:pos,ctx:(start>0?"…":"")+text.slice(start,pos+q.length+30)+"…"});pos+=qn.length;count++;}return out;}',
      'self.onmessage=function(ev){var d=ev.data||{};if(d.op==="search"){try{var hits=search(d.text,d.q||"");self.postMessage({id:d.id,ok:true,hits:hits});}catch(e){self.postMessage({id:d.id,ok:false,error:String((e&&e.message)||e)});}return;}if(d.op==="compress"){gz(d.text).then(function(r){self.postMessage({id:d.id,ok:true,result:r});}).catch(function(e){self.postMessage({id:d.id,ok:false,error:String((e&&e.message)||e)});});return;}if(d.op==="decompress"){ugz(d.text).then(function(r){self.postMessage({id:d.id,ok:true,result:r});}).catch(function(e){self.postMessage({id:d.id,ok:false,error:String((e&&e.message)||e)});});return;}try{var c=split(d.text,d.opts||{});self.postMessage({id:d.id,ok:true,chapters:c});}catch(e){self.postMessage({id:d.id,ok:false,error:String((e&&e.message)||e)});}};'
    ].join('\n');
  }
  function _spawn() {
    if (!_url) { var src = _workerSrc(); _url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' })); }
    var w = new Worker(_url);
    w.onmessage = function (ev) {
      var d = ev.data || {};
      var p = _pending[d.id];
      if (!p) return;
      delete _pending[d.id];
      /* 三处完成路径（onmessage / _rejectAll / 超时兜底）都必须 end 掉 jobId，
         漏任何一处，运维台「进程」页就会留下一条永不消失的幽灵任务。 */
      if (p.jobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(p.jobId); } catch (e) {} }
      if (p.cancel) { try { p.cancel(); } catch (e) {} }
      if (d.ok) p.resolve(d.chapters !== undefined ? d.chapters : (d.hits !== undefined ? d.hits : d.result));
      else p.reject(new Error(d.error));
    };
    w.onerror = function (e) {
      var msg = (e && e.message) || 'worker error';
      /* 标记所在池死亡并置空：下次调用会重建——不置 null 就会继续 postMessage 进死 Worker，永久 pending */
      var _deadOp = null;
      for (var k in _pool) { if (_pool[k] && _pool[k].w === w) { _pool[k].dead = true; _pool[k].w = null; _deadOp = k; } }
      /* 只 reject 这个 Worker 自己的 op：池是按 op 分开的，一个 split Worker 崩了
         不该把同时在跑的 compress / search 任务一起判死（与超时路径同一口径）。 */
      try { w.terminate(); } catch (_) {}
      if (_deadOp) _rejectAllOp(_deadOp, new Error('Worker 异常：' + msg + '（已重建，下次调用自动恢复）'));
      else _rejectAll(new Error('Worker 异常：' + msg + '（已重建，下次调用自动恢复）'));
    };
    return w;
  }
  function _ensure(op) {
    var key = (op === 'split') ? 'split' : op;
    var slot = _pool[key];
    if (slot && slot.w && !slot.dead) return slot.w;
    var w = _spawn();
    _pool[key] = { w: w, dead: false };
    return w;
  }
  function _rejectAll(err) {
    Object.keys(_pending).forEach(function (k) {
      var p = _pending[k]; delete _pending[k];
      if (p.jobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(p.jobId); } catch (e) {} }
      if (p && p.cancel) { try { p.cancel(); } catch (e) {} }
      try { p.reject(err); } catch (_) {}
    });
  }
  function _rejectAllOp(op, err) {
    /* 按 op 分组 reject，而非全局 _rejectAll：超时/崩溃时只清同 op 的 pending，
       不影响其它 op 的任务（如 split 超时不连坐 compress）。 */
    var _op = op || '?';
    Object.keys(_pending).forEach(function (k) {
      var p = _pending[k]; if (!p || p.op !== _op) return;
      delete _pending[k];
      if (p.jobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(p.jobId); } catch (e) {} }
      if (p.cancel) { try { p.cancel(); } catch (e) {} }
      try { p.reject(err); } catch (_) {}
    });
  }
  function _register(id, resolve, reject, meta) {
    if (Object.keys(_pending).length >= MAX_PENDING) {
      try { reject(new Error('任务队列已满（' + MAX_PENDING + '），请稍后重试')); } catch (e) {}
      return false;
    }
    var cancelFn = null;
    /* 任务元数据：进 _pending 时记下 op/大小/开始时间，并登记到 BF.jobs，
       运维台「进程」页据此显示"谁在跑、跑了多久"。
       _pending 本身是闭包私有，外部拿不到这些细节。 */
    var m = meta || {};
    var jobId = 0;
    /* search op 不登记 BF.jobs：
       search 是高频短命任务（书内/跨书搜索每批 6 章就一次，毫秒级完成），
       登记会让顶栏任务 chip 频繁闪动（begin→end）。split/compress/decompress 仍登记
       （真正会跑秒级以上的重任务，运维台需要可见）。超时/完成路径对 jobId=0 天然跳过。 */
    if (BF.jobs && BF.jobs.begin && (m.op || '?') !== 'search') {
      try { jobId = BF.jobs.begin(m.op || 'worker', { kind: 'worker', detail: m.detail || '' }); } catch (e) {}
    }
    _pending[id] = { resolve: resolve, reject: reject, op: m.op || '?', bytes: m.bytes || 0, jobId: jobId, get cancel() { return cancelFn; } };
    /* 超时兜底：到点未回包则 reject 并清 pending，避免永久悬挂 */
    if (BF.timers && BF.timers.timeout) cancelFn = BF.timers.timeout(function () {
      var p = _pending[id];
      if (!p) return;
      delete _pending[id];
      if (p.jobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(p.jobId); } catch (e) {} }
      /* 超时后把对应 Worker 终止并标记 dead，下次调用自动重建：
         只 reject 任务会让卡死的 Worker 继续占着池，后续消息永远不回。 */
      try {
        var _op = p.op || '?';
        var _slot = _pool[_op];
        if (_slot && _slot.w) { try { _slot.w.terminate(); } catch (e) {} _slot.dead = true; _slot.w = null; }
      } catch (e) {}
      try { p.reject(new Error('Worker 任务超时（>' + (TASK_TIMEOUT / 1000) + 's）')); } catch (e) {}
      /* 同一 op 的其余 pending 会因该 Worker 被终止而永远等不到回包，
         逐个熬到各自 60s 超时才 reject → 用户感觉"点搜索卡一分钟"。
         按 op 分组立即 reject 同 op 其余任务。 */
      try { _rejectAllOp(_op, new Error('Worker 任务超时（>' + (TASK_TIMEOUT / 1000) + 's）')); } catch (e) {}
    }, TASK_TIMEOUT);
    return true;
  }
  function _fmtBytes(n) { return n ? BF.util.fmtBytes(n) : ''; }   /* 任务详情里 0 字节留空，不显示「0 B」 */
  function _post(op, text, extra) {
    return new Promise(function (resolve, reject) {
      try {
        var w = _ensure(op);
        var id = ++_seq;
        if (!_register(id, resolve, reject, { op: op, bytes: text ? text.length : 0, detail: _fmtBytes(text ? text.length : 0) })) return;
        w.postMessage({ id: id, op: op, text: text, ...(extra || {}) });
      } catch (e) { reject(e); }
    });
  }
  function splitChaptersAsync(text, opts) {
    return new Promise(function (resolve, reject) {
      try {
        var w = _ensure('split');
        var id = ++_seq;
        if (!_register(id, resolve, reject, { op: 'split', bytes: text ? text.length : 0, detail: _fmtBytes(text ? text.length : 0) })) return;
        w.postMessage({ id: id, text: text, opts: opts || {} });
      } catch (e) { reject(e); }
    });
  }
  function compressAsync(text) { return _post('compress', text); }
  function decompressAsync(text) { return _post('decompress', text); }
  function searchAsync(text, q) { return _post('search', text, { q: q }); }
  function available() { return typeof Worker !== 'undefined'; }
  function syncFallback(text, opts) { return BF.library.splitChapters(text); }
  function poolSize() { return Object.keys(_pool).length; }
  function pendingCount() { return Object.keys(_pending).length; }
  /* 各 op 池的存活状态：运维台「进程」页要能区分"池已建但Worker 死了"和"池正常" */
  function poolStatus() {
    return POOL_OPS.map(function (op) {
      var slot = _pool[op];
      var live = !!(slot && slot.w && !slot.dead);
      return { op: op, live: live, dead: !!(slot && slot.dead), built: !!slot };
    });
  }
  function killAll() {   /* 供自愈/测试：主动清空并置死，下次调用重建 */
    Object.keys(_pool).forEach(function (k) { if (_pool[k] && _pool[k].w) { try { _pool[k].w.terminate(); } catch (e) {} } _pool[k] = { w: null, dead: true }; });
    _rejectAll(new Error('Worker 池已重置'));
  }
  return {
    splitChaptersAsync: splitChaptersAsync, compressAsync: compressAsync,
    decompressAsync: decompressAsync, searchAsync: searchAsync,
    available: available, syncFallback: syncFallback,
    poolSize: poolSize, pendingCount: pendingCount, killAll: killAll,
    poolStatus: poolStatus, POOL_OPS: POOL_OPS,
    TASK_TIMEOUT: TASK_TIMEOUT, MAX_PENDING: MAX_PENDING,
  };
})();

BF.bk = (function () {
  /* 自动备份的落盘键名统一取自 BF.store.K，杜绝各处硬编码字面量导致大小写漂移。
     键名大小写和 K 表对不上时，_snapshot 的 skip 集合排除不掉它 →
     新备份把以往所有备份又打包进去，体积超线性膨胀直至打爆 localStorage 配额；
     连带 clearCache 清不掉、顶栏数据状态认为无备份、
     OPFS/工作区四处排除列表全部失效。 */
  const AUTO_KEY = BF.store.K.AUTOBACKUPS;
  const MAX_BACKUPS = BF.CONFIG.BACKUP_MAX;
  /* 备份/导出需剥离的密钥（隐私过滤）—— 统一走 BF.store.PRIV_KEYS，
     判定逻辑只能有一处：各留一份副本就会和工作区同步的 _collect 漂移成两种，
     PIN 哈希只在一处被剔除。
     PIN 相关（pinHash/pinSalt/pinLock/aiLock）也在此列 ——
     PIN 哈希可被字典攻击穷举，比 API 密钥更敏感。 */
  const PRIV_KEYS = BF.store.PRIV_KEYS || new Set(['aiApiKey', 'mimoApiKey', 'aiEndpoint', 'aiModel', 'pinHash', 'pinSalt', 'pinLock', 'aiLock']);
  function _stripPriv(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    const s = JSON.parse(JSON.stringify(settings));
    PRIV_KEYS.forEach(function (k) { delete s[k]; });
    return BF.store.stripPresetSecrets(s);
  }

  /* ================= 备份加密（PBKDF2 + AES-GCM，Web Crypto） =================
     注意：Web Crypto 仅在安全上下文可用（https / localhost / file://）。
     file:// 与现代 Chromium 的 file:// 均可用；但通过普通 http:// 内网 IP 访问时
     crypto.subtle 为 undefined —— 此时加密导出自动降级为明文并提示，导入拒绝解密。
     isSecureCtx 供开机提示与设置页标注用（见下）。 */
  function _hasCrypto() { return !!(window.crypto && window.crypto.subtle); }
  function isSecureCtx() {
    try { return _hasCrypto(); } catch (e) { return false; }
  }
  /* 降级原因诊断：http(s) 且非 localhost 且无 subtle → 加密不可用，其余场景均可用 */
  function cryptoDiagnosis() {
    const has = isSecureCtx();
    const proto = (location && location.protocol) || '';
    const host = (location && location.hostname) || '';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '' || proto === 'file:';
    /* file:// 在现代 Chromium 属安全上下文，subtle 应可用；
       若 file:// 下仍无 subtle（极老内核），要给出明确降级说明而非空字符串。 */
    let reason = '';
    if (!has) {
      if (proto === 'file:') reason = '当前以 file:// 打开，但浏览器未提供 Web Crypto（需较新内核），加密备份不可用，将降级为明文';
      else if (isLocal) reason = '当前为本地访问（' + proto + '//' + host + '），但浏览器未提供 Web Crypto，加密备份不可用，将降级为明文';
      else reason = '当前以 ' + proto + '//' + host + ' 访问，非安全上下文（需 https 或 localhost），加密备份不可用，将降级为明文';
    }
    return { has, proto, host, isLocal, encrypted: has, reason: reason };
  }
  function _b64(buf) {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function _b642u(b64) {
    const s = atob(b64); const o = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  const _PBKDF_ITER = 600000;
  /* 迭代次数下限：新导出固定 600000，旧文件是 120000（必须继续能解）。
     读侧只认信封里写的数，等于让文件自己决定口令派生强度 —— 改成一个数就变成可穷举档。
     低于下限一律按下限算：真旧文件不受影响，改小的文件只会解不开（口令错误口径）。 */
  const _PBKDF_FLOOR = 120000;
  /* 上限同理：信封里的 iterations 由文件自己声明，只夹下限的话
     「改成 2 亿」就能让解密按钮把页面钉死。写侧固定用 600000，合法备份碰不到这条线。 */
  const _PBKDF_CEIL = 2000000;
  async function _deriveKey(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: Math.min(_PBKDF_CEIL, Math.max(_PBKDF_FLOOR, Number(iter) || _PBKDF_ITER)), hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }
  async function _encryptJSON(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await _deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { encrypted: true, v: 1, kdf: 'PBKDF2', iterations: _PBKDF_ITER, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) };
  }
  async function _decryptJSON(env, pass) {
    /* N3a：迭代次数取信封记录值，兼容旧备份（老文件 120000 仍可读）；新导出固定 600000 */
    const key = await _deriveKey(pass, _b642u(env.salt), env.iterations || _PBKDF_ITER);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _b642u(env.iv) }, key, _b642u(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* 数据摘要：全库只此一处实现（备份写入 / 恢复校验 / OPFS 快照同源）。
     各写一份必然漂移 —— 一处改了另一处还按旧算法校验，健康的备份会被判成损坏。
     FNV-1a，不依赖 Web Crypto，file:// 下也能用；只检出意外损坏，不抗篡改。 */
  function _ckSum(data) {
    let _h = 0x811c9dc5;
    const _s = JSON.stringify(data || {});
    for (let _i = 0; _i < _s.length; _i++) { _h ^= _s.charCodeAt(_i); _h = Math.imul(_h, 0x01000193) >>> 0; }
    return _h.toString(36);
  }
  async function _snapshot(opts) {
    /* 默认剥离密钥 —— 自动备份也走剥离，防备份文件明文落密钥/PIN。
       withSecrets === true 时保留（仅限用户显式「导出含密钥」迁移场景）。 */
    const withSecrets = !!(opts && opts.withSecrets);
    /* 收集全部 LS 数据（排除 corrupt/log 避免膨胀） */
    const out = { version: 2, at: Date.now(), type: 'full', data: {}, idb: {} };
    const skip = new Set([BF.store.K.CORRUPT, BF.store.K.LOG, BF.store.K.AUTOBACKUPS, BF.store.K.DSL_LOG]);
    for (const k of BF.store.lsKeys()) {
      if (skip.has(k)) continue;
      out.data[k] = BF.store.lsGet(k, null);
    }
    /* 默认剥离 settings 里的密钥/PIN；恢复后需重填（自动备份的语义是「数据可恢复」，密钥随时可重新输入） */
    if (!withSecrets && out.data[BF.store.K.SETTINGS]) {
      out.data[BF.store.K.SETTINGS] = _stripPriv(out.data[BF.store.K.SETTINGS]);
    }
    /* 备份 IDB 章节正文 + 标题，避免换机/清站点数据恢复出空书架。
       读不到正文时不能只留一个 idb:null 就走：备份清单上它和「这本书真没有正文」长得一样，
       而两者语义完全相反。打一个显式标记，恢复侧据此拒绝落盘 —— 恢复一份没抓到正文的备份，
       书架会指向本机读不到的正文，残留清理下一轮就把这些没归属的正文当垃圾删掉。 */
    try {
      out.idb.chapters = await BF.store.idbGetAll(BF.store.K.CHAPTERS, { strict: true });
      out.idb.chapter_titles = await BF.store.idbGetAll(BF.store.K.CHAPTER_TITLES, { strict: true });
    } catch (e) { BF.err.report('bk.snapshot.idb', e); out.idb = null; out.idbFailed = true; }
    /* 阶段3a：备份内容校验和。恢复前校验 data 摘要，能检出「备份写入中途损坏 /
       localStorage 被外部篡改 / 多标签并发覆盖」造成的脏数据，避免恢复出坏状态。
       用简单 FNV-1a 哈希（不依赖 Web Crypto，file:// 下也可用），对 data 序列化串求值。 */
    try { out.checksum = _ckSum(out.data); } catch (e) { out.checksum = null; }
    return out;
  }
  /* 内联整份的体积上限（序列化后的字符数）。
     没有 OPFS 时（隐私模式 / 旧内核 / 非安全上下文）备份只能内联进 localStorage，
     而一本 1MB 的书内联后约 4.1M 字符（UTF-16 约 8.3MB）——LS 总共才 5MB，
     一次自动备份就能把配额顶到 83%，随后 books_meta / highlights 的正常写入连环失败，
     驱逐阶梯还会顺手删掉运行日志去给它腾地方。
     超上限就只出声、不落这份备份：正文本来就在 IDB 里，
     内联一份进不下的副本既救不了数据，又会把可用空间吃光。 */
  const AUTO_INLINE_MAX_CHARS = 256 * 1024;
  let _autoSkipNoticed = false;
  async function _saveAuto(bk) {
    /* 优先把整本快照写进 OPFS（不把全本正文内联进 LS 的 autobackups 键）。
       OPFS 不可用或写入失败 → 回退内联整份（沿用旧行为，绝不丢数据）。 */
    let _entry = bk;        // 默认内联整份
    try {
      if (BF.snap) {
        const _name = (bk.at || Date.now()) + '.bfbak';
        const _w = await BF.snap.write('auto', 'full', _name, JSON.stringify(bk));
        if (_w && _w.ok) {
          _entry = { file: _name, at: bk.at, type: bk.type || 'auto', version: bk.version, checksum: bk.checksum, books: (bk.data && Object.keys(bk.data).length) || 0 };
        }
      }
    } catch (e) { _entry = bk; }
    if (_entry === bk) {
      let _chars = 0;
      try { _chars = JSON.stringify(bk).length; } catch (e) { _chars = Infinity; }
      if (_chars > AUTO_INLINE_MAX_CHARS) {
        if (!_autoSkipNoticed) {
          _autoSkipNoticed = true;
          BF.noti.warn('自动备份体积过大（全库约 ' + Math.round(_chars / 1024) + 'K 字符），本次已跳过', {
            action: { label: '改用导出备份', run: function () { try { BF.base && BF.base.open('backup'); } catch (e) {} } },
          });
        }
        BF.log && BF.log.warn('自动备份跳过：无 OPFS 可写，全库快照 ' + _chars + ' 字符超过内联上限 ' + AUTO_INLINE_MAX_CHARS);
        return 0;
      }
    }
    let list = BF.store.lsGet(AUTO_KEY, []);
    list.unshift(_entry);
    /* 轮转挤掉最旧的几份时，它们的 OPFS 文件要一起删：清单里没有条目之后，
       那个 .bfbak 就再没有入口，只会一直占着磁盘（手动删除走 delAt，那条同口径）。
       次序必须先清单后文件：先删文件的话，一旦清单没能落盘，留下的清单就指向
       已经不存在的 .bfbak —— 条目看着在、点开是坏的。溢出项这里先只从内存
       清单摘掉，等写成功再删文件。 */
    const _overflow = list.length > MAX_BACKUPS ? list.slice(MAX_BACKUPS) : [];
    if (list.length > MAX_BACKUPS) list.length = MAX_BACKUPS;
    const _dropFiles = function (arr) {
      if (!BF.snap) return;
      arr.forEach(function (x) {
        if (x && x.file) { try { BF.snap.remove('auto', 'full', x.file); } catch (e) { BF.err.report('bk.rotate.remove', e); } }
      });
    };
    /* 写入失败必须显式处理：lsSet 在配额耗尽时返回 false 而不抛异常。
       丢弃返回值就会照常弹「已生成自动备份」，用户以为有备份、实则静默丢失，
       且满额的备份块会挤占配额，连带 books_meta/highlights 的正常写入一并失败。
       降级要分级并检查每级返回值：全量写入失败先试保留最近 2 份，
       再试仅保留最新 1 份；连单份都写不下即「单份备份超配额」（本书太大），
       提示改用导出备份，不让用户到「基地」空转清理。
       每级写成功后，被这一级挤掉的条目文件一并删——不删就是孤儿。 */
    if (BF.store.lsSet(AUTO_KEY, list)) { _dropFiles(_overflow); return list.length; }
    if (BF.store.lsSet(AUTO_KEY, list.slice(0, 2))) {
      _dropFiles(_overflow.concat(list.slice(2)));
      BF.noti.error('自动备份失败：存储空间已满。已保留最近 2 份，请到「基地」清理空间或关闭自动备份');
      return 0;
    }
    if (BF.store.lsSet(AUTO_KEY, [bk])) {
      _dropFiles(_overflow.concat(list.slice(1)));
      BF.noti.error('自动备份失败：存储空间已满。已保留最近 1 份，请到「基地」清理空间或关闭自动备份');
      return 0;
    }
    BF.noti.error('本书太大，自动备份已不可用，请用导出备份');
    BF.log && BF.log.warn('自动备份：单份备份超配额（本书太大），自动备份不可用，请用导出备份');
    return 0;
  }
  async function autoNow() {
    const bk = await _snapshot();
    bk.type = 'auto';
    const n = await _saveAuto(bk);
    if (!n) return bk;   /* _saveAuto 已自行报错并降级，不再叠一条「成功」 */
    /* 自动备份落 LS 后异步副本写 IDB（分层：大体积备份正文进 IDB 减轻 LS 压力；LS 仍为主路径） */
    try { _syncAutoToIdb(); } catch (e) {}
    /* 备份完成带「查看备份」下一步 */
    const _act = (BF.next && BF.next.afterBackup) ? BF.next.afterBackup() : {};
    BF.noti.success('已生成自动备份（第 ' + n + ' 份）', _act);
    return bk;
  }
  function list() { return BF.store.lsGet(AUTO_KEY, []); }
  /* 自动备份双写 IDB（分层）。LS 仍是主读取路径，IDB 存副本 + 异步读取通道。
     后续可将主读取切到 IDB 彻底迁出 LS（需配合自愈等同步读取点改造）。 */
  function _syncAutoToIdb() {
    try { BF.store.idbKeyPut(AUTO_KEY, BF.store.lsGet(AUTO_KEY, [])).catch(function () {}); } catch (e) { BF.err.report('backup.autoToIdb', e); }
  }
  /* 备份列表异步读取（优先 IDB 副本、回退 LS）。供主读取切换/跨标签同步刷新使用。 */
  async function listAsync() {
    try { const v = await BF.store.idbKeyGet(AUTO_KEY); if (v != null) return v; } catch (e) { BF.log && BF.log.warn('storage.自动备份读取失败：' + (e && e.message)); }
    return BF.store.lsGet(AUTO_KEY, []);
  }
  async function restoreAt(i) {
    const list = BF.store.lsGet(AUTO_KEY, []);
    let bk = list[i];
    if (!bk) { BF.noti.warn('备份不存在'); return; }
    /* 新拓扑：清单里可能是 OPFS 文件清单（bk.file），需先读回实际快照 */
    if (bk.file) {
      try {
        const _txt = await BF.snap.read('auto', 'full', bk.file);
        if (_txt == null) throw new Error('snap.read null');
        bk = JSON.parse(_txt);
      } catch (e) {
        BF.err.report('backup.restore.readFile', e);
        if (bk.data == null) { BF.noti.error('备份文件读取失败，且无可回退的内联数据'); return; }
        /* 否则保留 bk（内含内联 data 的极端兼容场景），继续走内联恢复 */
      }
    }
    BF.ask.confirm({ title: '恢复备份', body: '确定恢复这份备份？当前数据将被覆盖。', confirmText: '恢复', danger: 2, op: 'backup.restore' })
      .then(async function (ok) {
        if (ok) { const r = await _apply(bk); if (r !== false) BF.noti.success('已恢复备份'); }
      });
  }
  function delAt(i) {
    const list = BF.store.lsGet(AUTO_KEY, []);
    if (!list[i]) return;
    const _ent = list[i];
    /* 新拓扑：清单项指向 OPFS 文件时要一并清掉文件，避免孤儿。
       文件必须等清单写成功之后再删：反过来的话清单写失败，
       留在盘上的条目就指着已经不存在的 .bfbak —— 看着在、点开是坏的。 */
    list.splice(i, 1);
    /* lsSet 在配额耗尽时返回 false 而不抛异常，
       删除必须按返回值门控：丢弃返回值会把
       删除失败报成成功，失败时降级报错。 */
    if (!BF.store.lsSet(AUTO_KEY, list)) {
      BF.noti.error('删除备份失败：存储空间不足');
      return;
    }
    if (_ent && _ent.file) { try { BF.snap.remove('auto', 'full', _ent.file); } catch (e) { BF.err.report('bk.del.remove', e); } }
    BF.noti.success('已删除备份');
    try { _syncAutoToIdb(); } catch (e) {}
  }
  /* 恢复落地前的键集合清理：保留备份列表自身、损坏隔离区、运行日志。
     AUTO_KEY 一律走常量比较，避免大小写漂移。
     回滚点只存内存（见 _apply），不跨标签页存活，因此不为它保留键；
     含密钥（withSecrets:true）的回滚点一律不得明文落盘 localStorage。 */
  function _wipeForRestore() {
    const keep = new Set([AUTO_KEY, BF.store.K.CORRUPT, BF.store.K.LOG]);
    for (const k of BF.store.lsKeys()) {
      if (keep.has(k)) continue;
      BF.store.lsRemove(k);
    }
  }
  /* 旧格式显式迁移分支：version<2 的备份没有校验和，
     无法做完整性自检。独立分支 + 显式询问（不静默放行、
     不静默拒绝），用户确认后才按当前格式迁移写入。 */
  function _askMigrate(bk) {
    return new Promise(function (res) {
      try {
        BF.ask.confirm({
          title: '旧版备份迁移',
          body: '这份备份是旧版格式（v' + (bk.version || 1) + '），没有校验和，无法做完整性自检。迁移会按当前格式重写数据。确定迁移这份旧备份？',
          danger: 2, scope: 'session', op: 'bk.migrate'
        }).then(function (ok) { res(ok === true); }).catch(function () { res(false); });
      } catch (e) {
        /* 询问框架不可用时保守拒绝 */
        BF.noti.error('备份缺少校验和，完整性自检未通过，已取消恢复');
        res(false);
      }
    });
  }
  /* 备份里的「安全配置」清单：恢复是逐键直写，这一族键跟着备份走就等于
     把锁、AI 出口、通知静音、脚本权限档位一起换掉。校验和是 FNV-1a（注释自己写明
     不抗篡改），拦不住改过值的备份，所以落盘前把差异列出来问一次。
     只列名字与去向，不打印值（接口地址这类非敏感项给主机名，便于判断是不是自己填的）。 */
  const SECURITY_LABELS = {
    pinLock: '启动锁', pinHash: '启动锁口令', pinSalt: '启动锁盐', aiLock: 'AI 锁',
    aiProvider: 'AI 服务商', aiEndpoint: 'AI 接口地址', aiModel: 'AI 默认模型',
    aiProxyBase: 'AI 转发地址', aiTransport: 'AI 传输方式', proxy: '本机代理',
    aiPresets: 'AI 配置预设', notiMute: '通知免打扰', autoBackup: '自动备份',
    garbleBlock: '乱码拦截', dsl_selfxss_ack: '终端首开警告', edgeToken: 'Edge 凭据', edgeSecVer: 'Edge 版本号',
    keyReveal: '密钥显示策略',
  };
  const SECURITY_LS_LABELS = { dsl_perm: '脚本权限档位', dsl_perm_granted: '脚本授权时间' };
  function _secCmp(cur, next, key, dflt) {
    const has = (o) => o && Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined && o[key] !== null;
    const a = has(cur) ? cur[key] : dflt;
    const b = has(next) ? next[key] : dflt;
    const j = (v) => { try { return JSON.stringify(v === undefined ? null : v); } catch (e) { return String(v); } };
    if (j(a) === j(b)) return null;
    const host = (v) => { try { return typeof v === 'string' && /^https?:/.test(v) ? new URL(v).host : v; } catch (e) { return v; } };
    const show = (v) => v === undefined || v === null || v === '' ? '未设置' : String(host(v)).slice(0, 40);
    return key + '：' + show(a) + ' → ' + show(b);
  }
  function _securityDiff(data) {
    const out = [];
    const D = (BF.settings && BF.settings.DEFAULTS) || {};
    const cur = (BF.settings && BF.settings.all) ? BF.settings.all() : {};
    let next = {};
    try { next = JSON.parse(JSON.stringify(data[BF.store.K.SETTINGS] || {})) || {}; } catch (e) { next = {}; }
    for (const k in SECURITY_LABELS) {
      const line = _secCmp(cur, next, k, D[k]);
      if (line) out.push(SECURITY_LABELS[k] + '（' + line + '）');
    }
    for (const k in SECURITY_LS_LABELS) {
      const line = _secCmp({}, data, k, BF.store.lsGet(k, null));
      if (line) out.push(SECURITY_LS_LABELS[k] + '（' + line + '）');
    }
    return out;
  }
  /* 恢复前把安全配置的变动摊开问一次：拒绝就什么都不写（此时还没清空，回滚点也没必要）。
     条数直接写进文案：这份清单是这里自己算出来的，不是经 verify 从数据层取的，
     套 {n} 占位符只会在框里留下字面量（占位符由框架在核实通过后才替换）。 */
  async function _askSecurityDiff(data) {
    const lines = _securityDiff(data || {});
    if (!lines.length) return true;
    const shown = lines.slice(0, 8).map(function (s) { return BF.dom.esc(s); }).join('<br/>') +
      (lines.length > 8 ? '<br/>……共 ' + lines.length + ' 项' : '');
    try {
      return await BF.ask.confirm({
        title: '这份备份还会改动安全相关设置',
        body: '除书籍与笔记外，恢复将写入 ' + lines.length + ' 项安全设置：<br/>' + shown +
          '<br/><br/>如果这份备份不是你自己的，建议先取消，改用「导入书籍文件」只拿正文。',
        confirmText: '连同安全设置一起恢复', danger: 3, op: 'bk.apply.security',
      }) === true;
    } catch (e) {
      /* 询问框架不可用时保守拒绝：安全配置的变动没被看过就不落盘 */
      BF.log && BF.log.warn('备份安全配置确认不可用，已取消恢复：' + ((e && e.message) || e));
      return false;
    }
  }
  /* 这份备份声称书架上有几本 —— 用来判断「正文缺席」到底有没有代价。
     空书架的备份没有正文本来就是对的，不该拦。 */
  function _backupShelfCount(data) {
    try {
      const arr = (data || {})[BF.store.K.BOOKS_META];
      return Array.isArray(arr) ? arr.length : 0;
    } catch (e) { return 0; }
  }
  /* 恢复前的形状关。备份/跨标签同步/别人给的文件都没有类型保证：
     `chapterIdx` 只要是一个带引号的字符串，拼进 data-* 就能把后面的属性变成可执行代码。
     这里做两件事——字段白名单 + 数值/字符串强校验；**非法条目隔离并计数，不整包拒绝**
     （整包拒绝等于「这份备份救不回来」，比丢一条脏记录严重得多）。 */
  const _SHAPE = {
    highlights: { idKey: 'id', num: ['chapterIdx', 'charOffset'], str: ['bookId', 'text', 'color', 'note'], max: 4000 },
    bookmarks: { num: ['chapterIdx', 'charOffset'], str: ['bookId', 'text'], max: 4000 },
    notes: { idKey: 'id', str: ['bookId', 'text', 'note'], max: 4000 },
    vocab: { str: ['bookId', 'word', 'note'], max: 2000 },
  };
  function _scrubShape(data) {
    let dropped = 0;
    for (const k in _SHAPE) {
      const arr = data && data[k];
      if (!Array.isArray(arr)) continue;
      const spec = _SHAPE[k];
      const keep = [];
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || typeof it !== 'object' || Array.isArray(it)) { dropped++; continue; }
        let bad = false;
        if (spec.idKey && it[spec.idKey] != null && !/^[\w:.-]{1,64}$/.test(String(it[spec.idKey]))) bad = true;
        (spec.num || []).forEach(function (f) {
          if (it[f] == null) return;
          const n = Number(it[f]);
          if (!Number.isInteger(n) || n < 0) bad = true; else it[f] = n;
        });
        (spec.str || []).forEach(function (f) {
          if (it[f] == null) return;
          if (typeof it[f] !== 'string') bad = true;
          else if (it[f].length > spec.max) it[f] = it[f].slice(0, spec.max);
        });
        if (bad) { dropped++; continue; }
        keep.push(it);
      }
      data[k] = keep;
    }
    return dropped;
  }
  async function _apply(bk) {
    /* 恢复安全网：先 _snapshot 存回滚点（含密钥，与当前数据一致），任何一步失败都回滚。
       两点必须守住：① lsSet 在配额耗尽时 return false 而不抛异常，「先清空后写入」
       之后逐键写若失败静默继续 → books_meta 写不回去 → 空书架却提示「已恢复备份」，
       回滚永不触发；② IDB 正文必须 await，否则 _apply 先返回、正文后落地，
       而回滚只还原 localStorage 不还原 IDB → 书架元数据与章节正文永久错配。 */
    let rollback = null;
    try {
      /* 进门先验形状：调用方给了字符串（没 JSON.parse）、给了 null、
         或给了一个没有 data 的对象，一律**在清空之前**拒掉。
         下面那句 _wipeForRestore() 是整条链上唯一不可逆的一步——
         它跑完之后books_meta/highlights 全被清空，而一份读不出内容的"备份"
         什么都恢复不了，结果就是清空之后如实报「已恢复」的空书架。 */
      if (typeof bk === 'string') {
        try { bk = JSON.parse(bk); } catch (e) { BF.noti.error('备份不是可解析的 JSON，已取消恢复'); return false; }
      }
      if (!bk || typeof bk !== 'object' || Array.isArray(bk)) {
        BF.noti.error('备份形状不对（应是一份对象），已取消恢复');
        return false;
      }
      if (!bk.data || typeof bk.data !== 'object' || Array.isArray(bk.data)) {
        BF.noti.error('备份里没有 data 段，无法恢复（当前数据未做任何改动）');
        return false;
      }
      /* 跨版本导入防护：v1/v2 为已知备份格式；更高未知版本拒绝恢复，
         防止未来版本的数据结构破坏当前版本。 */
      if (bk && bk.version != null && bk.version > 2) {
        BF.noti.error('备份版本过新（v' + bk.version + '），当前版本不支持恢复');
        return false;
      }
      /* 校验和封堵：checksum 缺失即拒——
         version<2 若无条件跳过校验，「声明自己是
         旧格式」就成为绕过完整性校验的通路。分两条：
         ① 真旧格式（version<2 且无 checksum）走独立显式
         迁移分支（_askMigrate：告知无法做完整性自检，
         用户显式确认后才迁移）；② 其余任何 checksum
         缺失即拒。FNV-1a 非密码学哈希，只能检出意外
         损坏，不能抗篡改。 */
      if (bk && !bk.checksum) {
        if (bk.version == null || bk.version < 2) {
          const _mig = await _askMigrate(bk);
          if (!_mig) return false;
        } else {
          BF.noti.error('备份缺少校验和，完整性自检未通过，已取消恢复');
          return false;
        }
      }
      if (bk && bk.checksum) {
        const _h = _ckSum(bk.data);
        if (_h !== bk.checksum) {
          BF.noti.error('备份校验和不匹配，可能已损坏，已取消恢复');
          BF.log && BF.log.warn('备份校验和失败：备份 ' + bk.checksum + ' vs 实际 ' + _h);
          return false;
        }
      }
      /* 安全配置差异先摊开问一次（此时还没清空、还没写，取消即原样不动）。 */
    if (!(await _askSecurityDiff(bk && bk.data))) {
      BF.noti.info('已取消恢复：安全设置的变动需要先看过再落盘');
      return false;
    }
    /* 正文缺席的备份不得落盘。这份快照明确记录了自己没读到正文（idb:null + idbFailed），
       恢复它只会换掉书架、把本机原有正文留在原地 —— 两边对不上号，下一轮残留清理
       就会把这些没归属的正文当垃圾删掉。此刻还没清空、还没写，取消即原样不动。
       只看 idb === null（显式失败），不看 undefined：更早的备份格式本来就没有 idb 字段，
       那一档的恢复行为保持不变。 */
    if (bk && bk.idb === null && _backupShelfCount(bk.data) > 0) {
      BF.noti.error('这份备份生成时没读到章节正文（书架上有 ' + _backupShelfCount(bk.data) + ' 本），恢复它会让书架指向读不到的正文，已取消');
      BF.log && BF.log.warn('bk.apply: 备份正文缺席（书架 ' + _backupShelfCount(bk.data) + ' 本），已拒绝恢复');
      return false;
    }
    /* 回滚点只存内存：_snapshot 存当前数据快照
         （含密钥，与当前数据一致），任何一步失败都据此回滚。
         含密钥的回滚点不能明文落盘 localStorage —— 那是未脱敏副本，
         等于多开一条明文落盘路径。回滚点不跨标签页存活。 */
      try {
        rollback = await _snapshot({ withSecrets: true });
      } catch (e) { rollback = null; }
      const data = bk.data || {};
      /* 形状校验在清空之前：宁可一条不写，也不要在写坏一半才发现 */
      const _droppedShape = _scrubShape(data);
      if (_droppedShape) BF.log.warn('备份里 ' + _droppedShape + ' 条记录形状不对，已跳过（其余照常恢复）');
      _wipeForRestore();
      /* 逐键写回并统计失败数：lsSet 静默失败是本链最隐蔽的一环，必须显式抛出才能触发回滚。
         force 是盲读闸门的正门：恢复就是拿备份整表覆盖现状，不该被本会话的读失败拦住。 */
      let failed = [];
      for (const k in data) {
        if (!BF.store.lsSet(k, data[k], { force: true })) failed.push(k);
      }
      if (failed.length) {
        throw new Error('写入失败 ' + failed.length + ' 个键（存储空间不足）：' + failed.slice(0, 3).join('、'));
      }
      /* IDB 章节正文 + 标题：必须 await 并纳入同一 try。
         只有备份里确实带了章节才用 idbRestore（含 clear()）整体替换；
         备份的 idb 没有章节（idb:{} / 空数组）不得据此清库 —— 那是「设置备份」，
         照做会把本机整库正文清空。清库必须由用户显式操作，不能由恢复推断。 */
      if (bk.idb && bk.idb.chapters && bk.idb.chapters.length) {
        await BF.store.idbRestore(BF.store.K.CHAPTERS, bk.idb.chapters);
        BF.log.info('恢复章节正文 ' + bk.idb.chapters.length + ' 段');
      }
      if (bk.idb && bk.idb.chapter_titles && bk.idb.chapter_titles.length) {
        await BF.store.idbRestore(BF.store.K.CHAPTER_TITLES, bk.idb.chapter_titles);
      }
      BF.settings.load();
      BF.theme.apply();
      BF.app.renderHome();
      BF.app.renderBookshelf();
      BF.library.refreshTagFilter();
      /* 备份剥离了密钥/PIN，恢复后检测缺失并提示重填 */
      try {
        if (!BF.settings.get('aiApiKey') && !BF.settings.get('mimoApiKey')) {
          BF.noti.info('备份不含 AI 密钥，如需 AI 功能请到「设置 → AI 服务」重新填写');
        }
        if (BF.settings.get('pinLock') && !BF.settings.get('pinHash')) {
          BF.noti.warn('备份不含 PIN，启动锁已失效；如需启用请重新设置');
        }
      } catch (e) {}
      if (_droppedShape) BF.noti.warn('有 ' + _droppedShape + ' 条记录形状不对，已跳过未恢复（其余已恢复）');
      return true;
    } catch (e) {
      BF.err.report('bk.apply', e);
      /* 回滚写必须检查返回值：lsSet 在循环里失败若静默继续，
         局部失败也会被报成「已自动回滚」。IDB 与 LS 同一失败判定：
         任一环节失败即回滚失败；文案不出现未经验证的
         「已回滚」。 */
      if (rollback) {
        let _rbFailed = false;
        try {
          _wipeForRestore();
          for (const k in (rollback.data || {})) {
            /* 回滚写永远要放行：这一步被拦住等于把「恢复失败」变成「数据全没」 */
            if (!BF.store.lsSet(k, rollback.data[k], { force: true })) _rbFailed = true;
          }
          if (_rbFailed) throw new Error('回滚写入失败（存储空间不足）');
          if (rollback.idb && rollback.idb.chapters && rollback.idb.chapters.length) {
            await BF.store.idbRestore(BF.store.K.CHAPTERS, rollback.idb.chapters);
          }
          if (rollback.idb && rollback.idb.chapter_titles && rollback.idb.chapter_titles.length) {
            await BF.store.idbRestore(BF.store.K.CHAPTER_TITLES, rollback.idb.chapter_titles);
          }
          BF.settings.load(); BF.theme.apply(); BF.app.renderHome(); BF.app.renderBookshelf();
          BF.noti.error('恢复失败，数据已还原到恢复前状态', { action: { label: '查看日志', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('logs'); } catch (eLog) {} } } });
        } catch (e2) {
          BF.err.report('bk.apply.rollback', e2);
          BF.app.recoveryFailedDialog('恢复失败且数据未能还原，请从「数据」重新导入备份');
        }
      } else {
        BF.app.recoveryFailedDialog('恢复失败且数据未能还原：从「数据」重新导入备份');
      }
      return false;
    }
  }
  async function exportFull(passphrase, withSecrets) {
    /* _snapshot 已默认剥离密钥；withSecrets=true 时保留（迁移场景）。 */
    const bk = await _snapshot({ withSecrets: !!withSecrets });
    bk.type = 'export';
    let payload, enc = false;
    if (passphrase && _hasCrypto()) {
      payload = JSON.stringify(await _encryptJSON(bk, passphrase));
      enc = true;
    } else {
      payload = JSON.stringify(bk);
      if (passphrase && !_hasCrypto()) BF.noti.warn('当前环境不支持加密（需 https/localhost），已导出明文备份');
    }
    const _ok = await BF.exportBlob('北风备份_' + new Date().toISOString().slice(0, 10) + (enc ? '_enc' : '') + '.json', payload, { mime: 'application/json' });
    /* 按 exportBlob 返回值门控（取消保存选择器不弹成功） */
    if (_ok) { BF.noti.success(enc ? '加密备份已导出（口令解密）' : (withSecrets ? '备份已导出（含密钥，请妥善保管）' : '备份已导出（已剥离密钥，含章节正文）')); try { BF.bus.emit(BF.EVENTS.EXPORT_DONE); } catch (e) {} }
  }
  /* 导出前询问是否加密（askOnExport 开启时）。
     刻意不用确认框：取消与 Esc 的语义会和「明文导出」混淆，
     误按 Esc 就导出明文。这里自建三态按钮，Esc 一律取消、不导出。 */
  function exportWithAsk() {
    if (!BF.settings.get('askOnExport')) return exportFull();
    if (!_hasCrypto()) {
      BF.noti.warn('当前环境不支持加密（需 https/localhost），将导出明文备份');
      return exportFull();
    }
    return new Promise(function (res) {
      BF.modal.custom('导出备份',
        '<div style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:16px">' +
        '是否使用<b>口令加密</b>导出？<br/>' +
        '<span style="color:var(--text-weak);font-size:12px">加密后导入需输入同一口令；明文为可直接查看的 JSON。</span><br/>' +
        '<span class="dlg-warn">⚠️ 口令一旦丢失将无法解密恢复备份，且无法重置，请务必牢记。</span>' +
        /* 默认剥离密钥；勾选后备份将包含 AI 密钥与 PIN（仅限迁移到新设备，请妥善保管） */
        '<label class="dlg-check" style="margin-top:10px;color:var(--text-dim)">' +
        '<input type="checkbox" id="bk-secrets"/>包含 AI 密钥与 PIN（默认不包含）</label></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" data-bk-cancel>取消</button>' +
        '<button class="btn btn-sm" data-bk-plain>明文导出</button>' +
        '<button class="btn btn-sm primary" data-bk-enc>加密导出</button>' +
        '</div>',
        function (box, dismiss) {
          var done = false;
          var finish = function (v) { if (done) return; done = true; dismiss(); res(v); };
          box.querySelector('[data-bk-cancel]').onclick = function () { finish('cancel'); };
          box.querySelector('[data-bk-plain]').onclick = function () {
            var cb = box.querySelector('#bk-secrets');
            finish(cb && cb.checked ? 'plain-secrets' : 'plain');
          };
          box.querySelector('[data-bk-enc]').onclick = function () {
            var cb = box.querySelector('#bk-secrets');
            finish(cb && cb.checked ? 'enc-secrets' : 'enc');
          };
        });
    }).then(async function (r) {
      if (r === 'plain') return exportFull();
      if (r === 'plain-secrets') return exportFull(null, true);
      if (r !== 'enc' && r !== 'enc-secrets') { BF.noti.info('已取消导出'); return; }
      const p = await BF.modal.prompt('加密导出', '请输入备份口令（导入时需用同一口令解密）', { type: 'password' });
      if (!p) { BF.noti.info('已取消导出'); return; }
      return exportFull(p, r === 'enc-secrets');
    });
  }
  function importFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async function () {
      try {
        const raw = JSON.parse(reader.result);
        if (!raw || typeof raw !== 'object') { BF.noti.error('备份格式错误'); return; }
        /* 加密备份：先解密再走常规导入流程 */
        if (raw.encrypted === true) {
          if (!_hasCrypto()) { BF.noti.error('当前环境不支持解密（需 https/localhost）'); return; }
          const p = await BF.modal.prompt('解密备份', '请输入备份口令', { type: 'password' });
          if (!p) return;
          let bk;
          try { bk = await _decryptJSON(raw, p); }
          catch (e) { BF.noti.error('解密失败：口令错误或备份不完整'); return; }
          BF.ask.confirm({ title: '导入备份', body: '导入将覆盖当前数据，确定继续？', confirmText: '导入', danger: 2, op: 'backup.import' })
            .then(async function (ok) { if (ok) { const r = await _apply(bk); if (r !== false) { BF.noti.success('加密备份已导入'); try { BF.bus.emit(BF.EVENTS.IMPORT_DONE); } catch (e) {} } } });
          return;
        }
        if (!raw.data) { BF.noti.error('备份格式错误'); return; }
        BF.ask.confirm({ title: '导入备份', body: '导入将覆盖当前数据，确定继续？', confirmText: '导入', danger: 2, op: 'backup.import' })
          .then(async function (ok) { if (ok) { const r = await _apply(raw); if (r !== false) { BF.noti.success('备份已导入'); try { BF.bus.emit(BF.EVENTS.IMPORT_DONE); } catch (e) {} } } });
      } catch (e) { BF.noti.error('备份解析失败'); }
    };
    reader.readAsText(f);
    input.value = '';
  }
  function resetAll() {
    /* danger-3 的确认不能只写着「不可恢复」四个字，要附可核实的数据。
       全库重置是三项真不可逆里唯一该在问前把真实数量摆出来的（书架 / 划线 /
       书签 / 便签 / 生词 / 自动备份都是同步可取的 LS 键）。verify 取到即逐类
       计数 + 「✓ 后果已按当前数据核实」；取不到（异常）自动降级为「未核实」，
       绝不带着假设问。 */
    return BF.ask.confirm({
      title: '重置全部',
      body: '确定删除所有数据？<b style="color:var(--danger-ink)">不可恢复！</b><br/>' +
        '本机现有：书 {books} 本 · 划线 {marks} 条 · 书签 {bookmarks} 条 · 便签 {notes} 条 · 生词 {vocab} 个 · 自动备份 {backups} 份。',
      confirmText: '确认删除', danger: 3, op: 'data.resetAll',
      verify: function () {
        const n = function (k) { return (BF.store.lsGet(k, []) || []).length; };
        return {
          books: n(BF.store.K.BOOKS_META), marks: n(BF.store.K.HIGHLIGHTS),
          bookmarks: n(BF.store.K.BOOKMARKS), notes: n(BF.store.K.NOTES),
          vocab: n(BF.store.K.VOCAB), backups: n(BF.store.K.AUTOBACKUPS),
        };
      },
    })
      .then(async function (ok) {
        if (!ok) return;
        try {
          for (const k of BF.store.lsKeys()) BF.store.lsRemove(k);
          /* 清 IDB 正文 + 标题：只列这个库里真有的两张表 —— 朗读音频由 BF.tts.cache 自己管，
             kv / ugc 在下面单独清，多列一张不存在的表就是一条永远删不掉的「残留」假警报。
             读不到时 strict 抛出并记进 _idbLeft：把它当空表等于一条没删，
             回执却仍写「已重置全部数据」。 */
          const _idbLeft = [];
          for (const store of ['chapters', 'chapter_titles']) {
            try {
              const all = await BF.store.idbGetAll(store, { strict: true });
              for (const rec of (all || [])) { try { await BF.store.idbDelete(store, rec.id); } catch (e) { BF.log.warn('重置清理失败（残留 ' + store + '/' + rec.id + '）：' + (e && e.message)); if (_idbLeft.indexOf(store) < 0) _idbLeft.push(store); } }
            } catch (e) { BF.log.warn('重置读取 ' + store + ' 失败：' + (e && e.message)); if (_idbLeft.indexOf(store) < 0) _idbLeft.push(store); }
          }
          /* 清 OPFS 快照 */
          try { await BF.enh.opfs.clear(); } catch (_) {}
          /* 新拓扑的整本正文与标注副本也要走：只清上面三张表的话，
             OPFS 的 books/ 与 IDB 的 kv / ugc 里还留着整本正文，回执却写「已重置全部数据」。
             清完回读一遍键，真有残留就写进 _idbLeft，别把没清掉的当成清掉了。 */
          for (const _st of ['kv', 'ugc']) {
            try {
              const _keys = await BF.store.idbAllKeys(_st, { strict: true });
              if (_keys && _keys.length) await BF.store.idbDeleteMany(_st, _keys);
              const _left = await BF.store.idbAllKeys(_st, { strict: true });
              if (_left && _left.length && _idbLeft.indexOf(_st) < 0) _idbLeft.push(_st);
            } catch (e) { BF.log.warn('重置清理 ' + _st + ' 失败：' + (e && e.message)); if (_idbLeft.indexOf(_st) < 0) _idbLeft.push(_st); }
          }
          try {
            if (BF.fsync && BF.fsync.available) {
              let _ents = null;
              try { _ents = await BF.fsync.ls('books'); } catch (e) { _ents = null; }   /* 目录不存在＝本来就没有，不算失败 */
              if (_ents && _ents.length) await BF.fsync.remove('books');
            }
          } catch (e) { BF.log.warn('重置清理 OPFS 正文失败：' + (e && e.message)); if (_idbLeft.indexOf('OPFS 正文') < 0) _idbLeft.push('OPFS 正文'); }
          BF.settings.reset();
          BF.theme.apply();
          BF.app.go('home');
          /* 回执要说真话：哪张表没清掉就写哪张，
             「已重置全部数据」盖住残留，等于把孤儿正文藏起来等下次开机再犯。 */
          if (_idbLeft.length) BF.noti.warn('已重置数据，但 ' + _idbLeft.join(' / ') + ' 未能清空（正文可能残留），可在「数据检查」里再清一次');
          else BF.noti.success('已重置全部数据');
        } catch (e) { BF.err.report('bk.resetAll', e); }
      });
  }
  /* 定时自动备份 */
  let _autoTimer = null;
  function startAuto() {
    if (!BF.settings.get('autoBackup')) return;
    if (_autoTimer) return;   /* 单例守卫：重复 install 不叠加定时器 */
    _autoTimer = BF.timers.interval(function () {
      /* 定时自动备份不能裸调：async autoNow 的失败会变成 unhandled rejection，
         不接住就没人知道备份没生成。这里 catch 后留痕。 */
      if (BF.settings.get('autoBackup')) {
        autoNow().catch(function (e) { BF.err.report('bk.autoNow', e); });
      }
    }, 6 * 3600 * 1000);
  }
  return { autoNow, list, listAsync, restoreAt, delAt, exportFull, exportWithAsk, importFile, resetAll, startAuto, _apply, _ckSum, PRIV_KEYS, hasCrypto: _hasCrypto, isSecureCtx: isSecureCtx, cryptoDiagnosis: cryptoDiagnosis };
})();

