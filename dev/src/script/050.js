/* ================= 压缩（真 gzip 优先，base64 兜底；异步 API） =================
 * 新数据：'gz1:' + base64(gzip字节) —— 中文正文压缩率通常 50%~70%，配额直接受益
 * 旧数据：无前缀的纯 base64，decompress 自动识别并照常解出
 * 环境：无 CompressionStream 时自动降级为 base64（正确性优先） */
BF.lz = (function () {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64encBytes(bytes) {
    let o = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i];
      const b2 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
      const b3 = i + 2 < bytes.length ? bytes[i + 2] : NaN;
      const e1 = b1 >> 2;
      const e2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
      const e3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
      const e4 = isNaN(b3) ? 64 : b3 & 63;
      o += B64.charAt(e1) + B64.charAt(e2) + (e3 === 64 ? '=' : B64.charAt(e3)) + (e4 === 64 ? '=' : B64.charAt(e4));
    }
    return o;
  }
  function b64dec(input) {
    const clean = String(input).replace(/=+$/, '');
    const bytes = [];
    let i = 0;
    while (i < clean.length) {
      const c1 = clean.charAt(i++);
      const c2 = clean.charAt(i++);
      const c3 = clean.charAt(i++);
      const c4 = clean.charAt(i++);
      /* 注意：charAt 越界返回 ''，B64.indexOf('') === 0 会把 e3/e4 误判为 0 导致多算字节 */
      const e1 = c1 !== '' ? B64.indexOf(c1) : -1;
      const e2 = c2 !== '' ? B64.indexOf(c2) : -1;
      const e3 = c3 !== '' ? B64.indexOf(c3) : -1;
      const e4 = c4 !== '' ? B64.indexOf(c4) : -1;
      if (e1 === -1 || e2 === -1) break;
      bytes.push((e1 << 2) | (e2 >> 4));
      if (e3 !== -1) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
      if (e4 !== -1) bytes.push(((e3 & 3) << 6) | e4);
    }
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (e) { return ''; }
  }
  function bytesToB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray ? bytes.subarray(i, i + CH) : bytes.slice(i, i + CH));
    return btoa(bin);
  }
  const WORKER_THRESHOLD = BF.CONFIG.WORKER_TEXT_THRESHOLD; /* >128KB 文本的压缩/解压移入 Worker 线程池，避免主线程卡顿 */
  async function compress(input) {
    if (input == null) return '';
    const text = String(input);
    if (text === '') return '';
    /* 大文本优先走 Worker（后台线程 gzip），失败静默回退主线程 */
    if (text.length > WORKER_THRESHOLD && typeof Worker !== 'undefined' && BF.workerPool && BF.workerPool.available()) {
      try { return await BF.workerPool.compressAsync(text); } catch (e) { BF.err.report('lz.compress.worker', e); }
    }
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('gzip');
        const blob = await new Response(new Blob([text]).stream().pipeThrough(cs)).blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        /* gzip 固定头 20+ 字节，过短内容压缩可能不划算，仍统一格式以便识别 */
        return 'gz1:' + bytesToB64(buf);
      } catch (e) { /* 压缩通路不可用就退回明文 base64：能存下，但体积涨数倍。
           这是容量事件（配额、读写耗时都会跟着变），必须出声，不能让用户以为还在压缩存。 */
        BF.log && BF.log.warn('codec.gzip 压缩不可用，本章已按明文 base64 入库（体积会明显增大）：' + (e && e.message)); }
    }
    /* 没有 CompressionStream（老浏览器 / file:// 下的部分环境）= 整本书以未压缩 base64 入库，
       体积约为压缩后的 3–4 倍，配额与读写耗时一起跟着变。这是容量事件：说一次，不逐章重复说。 */
    if (!compress._plainNoticed && text.length > 102400) {
      compress._plainNoticed = true;
      BF.log && BF.log.warn('此浏览器无 CompressionStream，正文按未压缩 base64 入库（体积约为压缩后的 3–4 倍）');
      try { BF.noti.info('这个浏览器不支持正文压缩，书库会多占约三四倍空间；换较新的浏览器能省下来'); } catch (e) { BF.err.report('lz.plainNotice', e); }
    }
    return b64encBytes(new TextEncoder().encode(text));
  }
  /* decompressSafe：把「解压炸了」和「这章本来就是空的」分成两件事。
     旧 decompress 失败折成空串，调用方无从分辨——重分章拿这个空串当正文，
     就把整本书重写成「少了那几章」，而界面只看章数，看不出少了字。
     decompress 保留旧签名（失败仍给空串），不动其他调用方；
     要把正文装配成整本书的地方（重分章 / AI 分章 / 清洗文本）必须走 safe 版并在失败时中止。 */
  async function decompressSafe(input) {
    if (input == null) return { ok: true, text: '' };
    const s = String(input);
    if (s.startsWith('gz1:')) {
      /* 大压缩包优先走 Worker 解压，失败回退主线程（回退后仍失败才算 ok:false） */
      if (s.length > WORKER_THRESHOLD && typeof Worker !== 'undefined' && BF.workerPool && BF.workerPool.available()) {
        try { return { ok: true, text: await BF.workerPool.decompressAsync(s) }; } catch (e) { BF.err.report('lz.decompress.worker', e); }
      }
      try {
        const bin = atob(s.slice(4));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ds = new DecompressionStream('gzip');
        const blob = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).blob();
        return { ok: true, text: await blob.text() };
      } catch (e) { BF.err.report('lz.decompress', e); return { ok: false, text: '', error: (e && e.message) || String(e) }; }
    }
    try { return { ok: true, text: b64dec(s) }; }
    catch (e2) { BF.err.report('lz.decompress.b64', e2); return { ok: false, text: '', error: (e2 && e2.message) || String(e2) }; }
  }
  async function decompress(input) { return (await decompressSafe(input)).text; }
  return { compress, decompress, decompressSafe };
})();
