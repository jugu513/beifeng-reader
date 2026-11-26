/* ================= ZIP 打包器（无依赖，store 不压缩） =================
   自实现一个最小 ZIP writer（local header +
   central directory + EOCD），仅 store 模式，CRC32 校验，单文件产出；
   asZip 分支必须真的产出 ZIP，不能与 TXT 分支共用同一份代码。 */
BF.zip = (function () {
  const CRC_T = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function _dos(now) {
    return {
      time: ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF,
      date: (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF,
    };
  }
  /** files: [{ name: string, data: Uint8Array }] → Blob */
  function pack(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const d = _dos(now);
    const body = [], central = [];
    let offset = 0;
    files.forEach(function (f) {
      const nameBytes = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(0);
      const crc = crc32(data);
      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);  /* 20 / flags(UTF-8 名) / store */
      lv.setUint16(10, d.time, true); lv.setUint16(12, d.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      body.push(lh, data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);   /* central 同样置 UTF-8 名标志，否则系统 unzip 按 CP437 解出乱码 */
      cv.setUint16(12, d.time, true); cv.setUint16(14, d.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    const centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob(body.concat(central, [eocd]), { type: 'application/zip' });
  }
  function save(blob, filename) {
    return BF.download(filename, blob);
  }
  return { crc32, pack, save };
})();

