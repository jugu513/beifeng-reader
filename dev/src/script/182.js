/* L14. MOBI / AZW3 导入 —— 零依赖 PalmDB 解析。
   结构（据 MobileRead wiki 与 calibre cPalmdoc 交叉核对）：
   PalmDB 头 78 字节 + 记录表（每条 8 字节偏移）→ record0 = PalmDOC 头 16B + MOBI 头 + EXTH
   → 正文记录 [1, PalmDOC.recordCount+1) → 尾随数据裁剪（extra data flags，calibre get_trailing_data 同款）
   → PalmDOC LZ77 解压（与 calibre cPalmdoc 逐分支一致）→ UTF-8 / CP1252 / GB18030 解码
   → 纯文本交 BF.smart.chapters 统一分章（本格式没有可靠目录，分章交给既有规则，不另起炉灶）。
   取舍：HUFF/CDIC（compression=17480）与 DRM 加密一律如实报错，不产出半本书；
   AZW3/KF8（mobiType=248）与 MOBI 同容器同记录，正文抽取同法，不单开分支。 */
BF.mobi = {
  sniff: function (buf, name) {
    if (/\.(?:mobi|azw3?)$/i.test(String(name || ''))) return true;
    if (!buf || buf.length < 68) return false;
    const td = new TextDecoder('latin1');
    const id = td.decode(buf.subarray(60, 68));
    return id === 'BOOKMOBI' || id === 'TEXtREAd';
  },

  /* ── PalmDOC LZ77（calibre cPalmdoc.c 同款分支）：
     0x01-0x08 = 后跟 N 个字面量；0x00/0x09-0x7F = 字面量；
     0xC0-0xFF = 空格 + (c^0x80)；0x80-0xBF = 距离长度对（14 位：11 距离 + 3 长度，长度 = 低位+3） */
  _palmdoc: function (input) {
    let cap = Math.max(input.length * 4, 1024);
    let out = new Uint8Array(cap);
    let o = 0;
    const ensure = function (need) {
      if (o + need <= cap) return;
      while (cap < o + need) cap *= 2;
      const b = new Uint8Array(cap);
      b.set(out.subarray(0, o));
      out = b;
    };
    let i = 0;
    const n = input.length;
    while (i < n) {
      const c = input[i++];
      if (c >= 1 && c <= 8) {
        ensure(c);
        for (let k = 0; k < c && i < n; k++) out[o++] = input[i++];
      } else if (c <= 0x7f) {
        ensure(1); out[o++] = c;
      } else if (c >= 0xc0) {
        ensure(2); out[o++] = 0x20; out[o++] = c ^ 0x80;
      } else if (i < n) {
        const v = (c << 8) + input[i++];
        const di = (v & 0x3fff) >> 3;
        const ln = (v & 7) + 3;
        if (di <= o && di > 0) {
          ensure(ln);
          for (let k = 0; k < ln; k++) { out[o] = out[o - di]; o++; }
        }
      }
    }
    return out.subarray(0, o);
  },

  /* ── 变宽整数（MOBI variable-width integer）：从尾部倒着读，
     低 7 位累积、最高位 = 终止标志；返回 {sz, consumed} ── */
  _decintBack: function (bytes, end) {
    let val = 0, consumed = 0;
    const acc = [];
    for (let p = end - 1; p >= 0; p--) {
      const b = bytes[p];
      acc.push(b & 0x7f);
      consumed++;
      if (b & 0x80) break;
      if (consumed > 4) break;
    }
    acc.reverse();
    for (const b of acc) val = (val << 7) | b;
    return { sz: val, consumed: consumed };
  },

  /* ── 尾随数据裁剪（calibre get_trailing_data 同款）：
     extraDataFlags 每个置位 bit 对应一段 <payload><变宽长度>；
     bit0 另管尾部多字节重叠字符（低 2 位定长） ── */
  _stripTrailing: function (rec, flags) {
    if (!flags) return rec;
    let end = rec.length;
    let f = flags >> 1;
    while (f) {
      if (f & 1) {
        const { sz, consumed } = this._decintBack(rec, end);
        if (sz > consumed && sz <= end) end -= sz;
        else if (sz <= end) end -= sz;
        else break;
      }
      f >>= 1;
    }
    if (flags & 1) {
      if (end < 1) return rec.subarray(0, 0);
      const sz = (rec[end - 1] & 3) + 1;
      if (sz <= end) end -= sz;
    }
    return rec.subarray(0, end);
  },

  /* ── 解码：MOBI 头给了编码就按它走；老 PalmDOC 没头的，UTF-8 严格试、
     失败转 GB18030、再失败落 CP1252（中文掌上书常见 GBK 系） ── */
  _decode: function (bytes, encoding) {
    const tryDec = function (label) {
      try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch (e) { return null; }
    };
    if (encoding === 65001) return tryDec('utf-8') || new TextDecoder('utf-8').decode(bytes);
    if (encoding === 1252) return new TextDecoder('windows-1252').decode(bytes);
    return tryDec('utf-8') || tryDec('gb18030') || new TextDecoder('windows-1252').decode(bytes);
  },

  /* ── 主链路 ── */
  parse: async function (bytes) {
    if (!bytes || bytes.length < 86) throw new Error('文件太小，不是 MOBI');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = function (p) { return dv.getUint16(p, false); };
    const u32 = function (p) { return dv.getUint32(p, false); };
    const numRec = u16(76);
    if (numRec < 1 || 78 + numRec * 8 > bytes.length) throw new Error('PalmDB 记录表损坏');
    const offs = [];
    for (let i = 0; i < numRec; i++) offs.push(u32(78 + i * 8));
    for (let i = 1; i < numRec; i++) if (offs[i] < offs[i - 1]) throw new Error('PalmDB 记录偏移乱序');
    const recEnd = function (i) { return i < numRec - 1 ? offs[i + 1] : bytes.length; };
    const rec0 = bytes.subarray(offs[0], recEnd(0));
    if (rec0.length < 16) throw new Error('record0 损坏');
    const compression = dv.getUint16(offs[0], false);
    const encryption = dv.getUint16(offs[0] + 12, false);
    if (encryption !== 0) throw new Error('带 DRM 加密，暂不支持');
    if (compression === 17480) throw new Error('HUFF/CDIC 压缩暂不支持');
    if (compression !== 1 && compression !== 2) throw new Error('未知压缩方式 ' + compression);

    const td4 = new TextDecoder('latin1');
    let encoding = 0, firstImage = 0xffffffff, fullName = '', exthTitle = '', exthAuthor = '';
    let extraFlags = 0, textRecCount = 0;
    const mobiId = td4.decode(rec0.subarray(16, 20));
    if (mobiId === 'MOBI' && rec0.length >= 24) {
      const headerLen = u32(offs[0] + 20);
      if (rec0.length >= 32) encoding = u32(offs[0] + 28);
      if (rec0.length >= 84) textRecCount = 0; /* PalmDOC 字段已给，占位防误读 */
      if (rec0.length >= 112) firstImage = u32(offs[0] + 108);
      if (rec0.length >= 92) {
        const fnOff = u32(offs[0] + 84), fnLen = u32(offs[0] + 88);
        if (fnLen > 0 && fnLen < 1024 && fnOff + fnLen <= rec0.length) {
          fullName = new TextDecoder('utf-8').decode(rec0.subarray(fnOff, fnOff + fnLen)).replace(/\0+$/, '').trim();
        }
      }
      if (rec0.length >= 244) extraFlags = u32(offs[0] + 240);
      const exthFlags = rec0.length >= 132 ? u32(offs[0] + 128) : 0;
      if ((exthFlags & 0x40) && 16 + headerLen + 12 <= rec0.length) {
        const es = 16 + headerLen;
        if (td4.decode(rec0.subarray(es, es + 4)) === 'EXTH') {
          const exthLen = dv.getUint32(offs[0] + es + 4, false);
          const cnt = dv.getUint32(offs[0] + es + 8, false);
          let p = es + 12;
          const bound = Math.min(es + exthLen, rec0.length);
          for (let k = 0; k < cnt && p + 8 <= bound; k++) {
            const t = dv.getUint32(offs[0] + p, false);
            const l = dv.getUint32(offs[0] + p + 4, false);
            if (l < 8 || p + l > bound) break;
            if (t === 100 && !exthAuthor) exthAuthor = new TextDecoder('utf-8').decode(rec0.subarray(p + 8, p + l)).replace(/\0+$/, '').trim();
            if (t === 503 && !exthTitle) exthTitle = new TextDecoder('utf-8').decode(rec0.subarray(p + 8, p + l)).replace(/\0+$/, '').trim();
            p += l;
          }
        }
      }
    }
    /* PDB 库名兜底（31 字节，C 串） */
    let pdbName = '';
    try {
      pdbName = new TextDecoder('utf-8').decode(bytes.subarray(0, 32)).replace(/\0[\s\S]*$/, '').trim();
    } catch (e) { pdbName = ''; }

    /* 正文记录上界：PalmDOC.recordCount（= 用于正文的记录数）最权威，
       再用 firstImage 封顶，防止把图片/FLIS 垃圾当正文解压 */
    textRecCount = dv.getUint16(offs[0] + 8, false);
    let end = textRecCount + 1;
    if (!(end >= 2 && end <= numRec)) end = numRec;
    if (firstImage >= 2 && firstImage < end) end = firstImage;

    const parts = [];
    for (let r = 1; r < end; r++) {
      let rec = bytes.subarray(offs[r], recEnd(r));
      if (!rec.length) continue;
      rec = this._stripTrailing(rec, extraFlags);
      if (compression === 2) rec = this._palmdoc(rec);
      parts.push(rec);
    }
    let total = 0;
    for (const p of parts) total += p.length;
    if (!total) throw new Error('没有可读正文记录');
    const joined = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { joined.set(p, at); at += p.length; }
    const raw = this._decode(joined, encoding);
    if (!raw || !raw.trim()) throw new Error('正文解码为空');
    /* MOBI 正文是 Mobi7 HTML；剥标签后交统一分章 */
    const text = BF.epub._html2Text(raw);
    if (!text) throw new Error('没有可读正文');
    return {
      title: exthTitle || fullName || pdbName || '',
      creator: exthAuthor || '',
      text: text,
    };
  },
};
/* MOBI 段结束 */
