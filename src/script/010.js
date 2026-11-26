/* ================= 4d. BF.caps 能力检测 =================
   各模块（BF.bk.cryptoDiagnosis、workerPool.available、opfs.snapshot、
   BroadcastChannel 早退…）零散的 try/catch 探测统一为只读快照，供运维台
   「能力」页渲染；散落各处则无法聚合展示。
   全部包try：能力检测本身就是最不能抛异常的地方（它要在别的模块出问题时仍然可用）。 */
BF.caps = (function () {
  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function list() {
    var out = [];
    var proto = safe(function () { return location.protocol || ''; }, '');
    var isFile = proto === 'file:';
    var secure = safe(function () { return BF.bk && BF.bk.isSecureCtx ? BF.bk.isSecureCtx() : !!(window.crypto && crypto.subtle); }, false);

    out.push({
      key: 'protocol', label: '访问协议', ok: true,
      detail: proto + (isFile ? '（本地文件）' : '（网络访问）'),
      note: isFile ? 'Web Crypto 可用' : (secure ? '安全上下文' : '非安全上下文：加密备份降级为明文'),
    });
    out.push({
      key: 'idb', label: 'IndexedDB', ok: safe(function () { return !!window.indexedDB; }, false),
      detail: safe(function () { return window.indexedDB ? '章节正文存储可用' : '不可用（章节将无法持久化）'; }, '探测失败'),
    });
    out.push({
      key: 'worker', label: 'Web Worker', ok: safe(function () { return typeof Worker !== 'undefined'; }, false),
      detail: safe(function () {
        if (typeof Worker === 'undefined') return '不可用：大文件分章将回退同步，可能卡界面';
        return '池 ' + (BF.workerPool ? BF.workerPool.poolSize() : 0) + ' 个 · 待处理 ' + (BF.workerPool ? BF.workerPool.pendingCount() : 0);
      }, '探测失败'),
    });
    out.push({
      key: 'quota', label: '存储配额', ok: safe(function () { return !!(navigator.storage && navigator.storage.estimate); }, false),
      detail: 'navigator.storage.estimate' + (safe(function () { return navigator.storage && navigator.storage.estimate; }, false) ? ' 可用（可显示占用）' : ' 不可用（占用显示为 —）'),
    });
    out.push({
      key: 'crypto', label: '加密备份', ok: secure,
      detail: secure ? 'AES-GCM + PBKDF2 可用' : '降级为明文导出（需 https 或 localhost）',
    });
    out.push({
      key: 'opfs', label: 'OPFS 文件系统',
      /* 报实际能力而不是 API 存在性：getDirectory 句柄存在不等于真能用
         （file:// 下 Chromium 抛 SecurityError，面板却显示可用——面板说过谎）。
         BF.fsync.init 启动时真调过一次 getDirectory，这里读它的结论；
         init 未跑完时按 API 存在性兜底。 */
      ok: safe(function () {
        if (BF.fsync && typeof BF.fsync.ok === 'function') return BF.fsync.ok();
        return !!(navigator.storage && navigator.storage.getDirectory);
      }, false),
      detail: safe(function () {
        if (BF.fsync && typeof BF.fsync.ok === 'function' && BF.fsync.ok()) return '可用（大文件快照）';
        return (navigator.storage && navigator.storage.getDirectory) ? '不可用：getDirectory 被浏览器拒绝（仅用 IndexedDB）' : '不可用（仅用 IndexedDB）';
      }, '探测失败'),
    });
    out.push({
      key: 'bc', label: '跨标签页同步', ok: safe(function () { return typeof BroadcastChannel !== 'undefined'; }, false),
      detail: safe(function () { return typeof BroadcastChannel !== 'undefined' ? 'BroadcastChannel 可用' : '不可用（多标签不同步）'; }, '探测失败'),
    });
    out.push({
      key: 'tts', label: '语音朗读', ok: safe(function () { return BF.tts && BF.tts.offline ? BF.tts.offline.available() : false; }, false),
      detail: safe(function () { return BF.tts && BF.tts.offline && BF.tts.offline.available() ? '本地语音可用' : '不可用（将走系统语音）'; }, '探测失败'),
    });
    var edgeTok = (BF.settings && BF.settings.get) ? (BF.settings.get('edgeToken') || '') : '';
    out.push({
      key: 'edgeToken', label: 'Edge 凭据 Token', ok: true,
      detail: edgeTok ? ('自定义覆盖生效（' + String(edgeTok).length + ' 字符）') : '使用内置公开 Token（失效时到设置→语音自填）',
    });
    return out;
  }
  /* 概览用：ok / total 计数。degraded=true 表示有不可用项（但不一定是故障，
     比如 TTS 不可用只影响朗读） */
  function summary() {
    var l = list();
    var ok = l.filter(function (c) { return c.ok; }).length;
    return { ok: ok, total: l.length, degraded: ok < l.length, list: l };
  }
  return { list: list, summary: summary };
})();

