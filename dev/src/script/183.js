/* L15. PDF 文本抽取 —— 零依赖最小实现，面向电子书类 PDF，不面向扫描件。
   链路：按内容扫对象（经典 xref 表与对象流 ObjStm 都不依赖、各自解析）→
   /Root → /Pages 递归 → 每页 /Contents（FlateDecode = zlib 包裹，用原生
   DecompressionStream('deflate') 解，与 EPUB 的 raw deflate 不同）→
   内容流里 Tj/TJ/'/" 取字 → 字体 /ToUnicode CMap（bfchar/bfrange）解码；
   没有 ToUnicode 的按 WinAnsi/拉丁回退 → 拼成纯文本交 BF.smart.chapters 统一分章。
   取舍（如实报，不产半成品）：扫描件（纯图页）抽不出字，全书无字则报错；
   老编码无 ToUnicode 的中文可能出乱码，交给下游乱码判据拦；不支持的滤镜跳过该流。 */
BF.pdf = {
  sniff: function (buf, name) {
    if (/\.pdf$/i.test(String(name || ''))) return true;
    return !!(buf && buf.length > 5 && buf[0] === 0x25 && buf[1] === 0x50 &&
      buf[2] === 0x44 && buf[3] === 0x46); /* %PDF */
  },

  /* ── 字节 ↔ 二进制字符串（latin1 映射，切片即字节精确） ── */
  _bin: function (bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return s;
  },
  _bytesOf: function (binStr) {
    const b = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) b[i] = binStr.charCodeAt(i) & 0xff;
    return b;
  },

  /* ── FlateDecode（zlib 包裹） ── */
  _inflate: function (bytes) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  },

  /* ── 流数据：dict 之后的 stream … endstream（二进制字符串切片字节精确） ── */
  _streamData: function (body) {
    const s = body.indexOf('stream');
    if (s < 0) return '';
    let p = s + 6;
    if (body.charCodeAt(p) === 13) p++;
    if (body.charCodeAt(p) === 10) p++;
    const e = body.indexOf('endstream', p);
    return e < 0 ? '' : body.slice(p, e);
  },

  /* ── CMap 解析：codespace 定字宽，bfchar/bfrange 建码表 ── */
  _parseCMap: function (cmap) {
    const table = {};
    let width = 1;
    const cs = cmap.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
    if (cs) width = Math.max(1, cs[1].length / 2);
    const hexToStr = function (h) {
      let out = '';
      for (let i = 0; i + 4 <= h.length; i += 4) {
        const u = parseInt(h.substr(i, 4), 16);
        if (isFinite(u)) out += String.fromCharCode(u);
      }
      return out;
    };
    const put = function (code, str) { if (str) table[code] = str; };
    let m;
    const fc = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = fc.exec(cmap))) {
      const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let p;
      while ((p = pair.exec(m[1]))) put(parseInt(p[1], 16), hexToStr(p[2]));
    }
    const fr = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = fr.exec(cmap))) {
      const range = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
      let r;
      while ((r = range.exec(m[1]))) {
        const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16);
        if (!isFinite(lo) || !isFinite(hi) || hi < lo) continue;
        if (r[4]) { /* 码点递增：末 16 位 +i */
          const base = parseInt(r[4], 16);
          const n = Math.min(hi - lo, 65535);
          for (let i = 0; i <= n; i++) put(lo + i, hexToStr((base + i).toString(16).padStart(r[4].length, '0')));
        } else if (r[5] != null) { /* 数组形式逐个给 */
          const items = r[5].match(/<([0-9A-Fa-f]+)>/g) || [];
          const n = Math.min(hi - lo, items.length - 1);
          for (let i = 0; i <= n; i++) put(lo + i, hexToStr(items[i].slice(1, -1)));
        }
      }
    }
    return { table: table, width: width };
  },

  /* ── 内容流取字：手写轻量分词（PDF 内容流的字符串带转义与嵌套括号，正则啃不动） ── */
  _contentText: function (content, fontMaps, defaultMap) {
    const out = [];
    let i = 0;
    const n = content.length;
    let curMap = defaultMap;
    let pending = [];        /* 操作数栈：字符串与数字混放 */
    const readParen = function (start) { /* ( … ) 字符串，返回 {s, end} */
      let depth = 0, p = start;
      let s = '';
      for (; p < n; p++) {
        const ch = content.charAt(p);
        if (ch === '\\') {
          const nx = content.charAt(p + 1);
          if (nx === 'n') { s += '\n'; p++; }
          else if (nx === 'r') { s += '\r'; p++; }
          else if (nx === 't') { s += '\t'; p++; }
          else if (nx === '(' || nx === ')' || nx === '\\') { s += nx; p++; }
          else if (nx >= '0' && nx <= '7') {
            let oct = '';
            for (let k = 0; k < 3 && p + 1 < n && content.charAt(p + 1) >= '0' && content.charAt(p + 1) <= '7'; k++) {
              oct += content.charAt(++p);
            }
            s += String.fromCharCode(parseInt(oct, 8) & 0xff);
          } else { s += nx; p++; }
          continue;
        }
        if (ch === '(') { depth++; if (depth > 1) s += ch; continue; }
        if (ch === ')') { depth--; if (depth === 0) return { s: s, end: p + 1 }; s += ch; continue; }
        if (depth > 0) s += ch;
      }
      return { s: s, end: p };
    };
    const decodeStr = function (s) {
      const map = curMap || defaultMap;
      const bytes = [];
      for (let k = 0; k < s.length; k++) bytes.push(s.charCodeAt(k) & 0xff);
      let res = '';
      if (map && map.width === 2) {
        for (let k = 0; k + 1 < bytes.length; k += 2) {
          const code = (bytes[k] << 8) | bytes[k + 1];
          res += map.table[code] || '';
        }
      } else if (map && map.table) {
        for (let k = 0; k < bytes.length; k++) {
          res += map.table[bytes[k]] !== undefined ? map.table[bytes[k]] : String.fromCharCode(bytes[k]);
        }
      } else {
        res = new TextDecoder('windows-1252').decode(new Uint8Array(bytes));
      }
      return res;
    };
    const isOp = function (w) { return /^[A-Za-z'"*]{1,3}$/.test(w); };
    let word = '';
    const flushWord = function () {
      if (!word) return;
      const w = word; word = '';
      if (!isOp(w)) { pending.push({ num: parseFloat(w) }); return; }
      if (w === 'Tj' || w === "'") {
        if (w === "'") out.push('\n');
        /* 栈上可能压着多段字符串操作数（<4E2D><6587> Tj 这类写法）：全部取出拼接，
           只取栈顶会把前面的字全丢掉——失败得很难看（每行只剩最后一个字） */
        const strs = pending.filter(function (x) { return x.s !== undefined; });
        if (strs.length) out.push(strs.map(function (x) { return decodeStr(x.s); }).join(''));
      } else if (w === 'TJ') {
        const last = pending.pop();
        if (last && last.arr) {
          for (const it of last.arr) {
            if (it.s !== undefined) out.push(decodeStr(it.s));
            else if (typeof it.num === 'number' && it.num >= 500) out.push(' ');
          }
        }
      } else if (w === '"') {
        out.push('\n');
        pending = [];
      } else if (w === 'Tf') {
        const name = pending.filter(function (x) { return x.name; }).pop();
        if (name && fontMaps[name.name]) curMap = fontMaps[name.name];
        pending = [];
      } else if (w === 'T*' || w === 'Tm' || w === 'Td' || w === 'TD') {
        out.push('\n');
        pending = [];
      } else {
        pending = [];
      }
    };
    while (i < n) {
      const ch = content.charAt(i);
      if (ch === '(') {
        const r = readParen(i);
        pending.push({ s: r.s });
        i = r.end;
        continue;
      }
      if (ch === '<' && content.charAt(i + 1) !== '<') { /* 十六进制串 */
        const e = content.indexOf('>', i);
        if (e > 0) {
          let h = content.slice(i + 1, e).replace(/\s+/g, '');
          if (h.length % 2) h += '0';
          pending.push({ s: h });
          /* hex 串按 hex 解：转成字节串交给 decodeStr 前先落地 */
          let raw = '';
          for (let k = 0; k < h.length; k += 2) raw += String.fromCharCode(parseInt(h.substr(k, 2), 16));
          pending[pending.length - 1] = { s: raw };
          i = e + 1;
          continue;
        }
      }
      if (ch === '[') { /* 数组操作数（TJ 用） */
        let p = i + 1;
        const arr = [];
        while (p < n && content.charAt(p) !== ']') {
          const c2 = content.charAt(p);
          if (c2 === '(') {
            const r = readParen(p);
            arr.push({ s: r.s });
            p = r.end;
          } else if (c2 === '<') {
            const e = content.indexOf('>', p);
            if (e > 0) {
              let h = content.slice(p + 1, e).replace(/\s+/g, '');
              if (h.length % 2) h += '0';
              let raw = '';
              for (let k = 0; k < h.length; k += 2) raw += String.fromCharCode(parseInt(h.substr(k, 2), 16));
              arr.push({ s: raw });
              p = e + 1;
              continue;
            }
            p++;
          } else if (/\s/.test(c2)) p++;
          else if (c2 === '-' || (c2 >= '0' && c2 <= '9')) {
            let num = '';
            while (p < n && /[-0-9.]/.test(content.charAt(p))) num += content.charAt(p++);
            arr.push({ num: parseFloat(num) });
          } else p++;
        }
        pending.push({ arr: arr });
        i = p + 1;
        continue;
      }
      if (ch === '/' && !word) { /* 资源名（/F1 这类） */
        let nm = '';
        while (i + 1 < n && /[A-Za-z0-9+_.-]/.test(content.charAt(i + 1))) nm += content.charAt(++i);
        pending.push({ name: nm });
        i++;
        continue;
      }
      if (/\s/.test(ch)) { flushWord(); i++; continue; }
      if (ch === ']') { flushWord(); i++; continue; }
      word += ch;
      i++;
    }
    flushWord();
    return out.join('');
  },

  /* ── 主链路 ── */
  parse: async function (bytes) {
    if (!bytes || bytes.length < 16 || bytes[0] !== 0x25) throw new Error('不是 PDF（缺 %PDF- 头）');
    const bin = this._bin(bytes);
    const self = this;

    /* ① 按内容扫对象；随后展开对象流（ObjStm 内层对象覆盖同号外层） */
    const objects = {};
    const re = /(\d+)\s+\d+\s+obj\b/g;
    let m;
    while ((m = re.exec(bin))) {
      const start = m.index + m[0].length;
      const end = bin.indexOf('endobj', start);
      objects[m[1]] = end < 0 ? bin.slice(start) : bin.slice(start, end);
    }
    const objKeys = Object.keys(objects);
    for (const k of objKeys) {
      const body = objects[k];
      if (!/\/Type\s*\/ObjStm/.test(body)) continue;
      try {
        const data = self._streamData(body);
        if (!data) continue;
        const firstM = body.match(/\/First\s+(\d+)/);
        const nM = body.match(/\/N\s+(\d+)/);
        if (!firstM) continue;
        const inflated = await self._inflate(self._bytesOf(data));
        const inner = self._bin(inflated);
        const first = parseInt(firstM[1], 10);
        const cnt = nM ? parseInt(nM[1], 10) : 9999;
        const header = inner.slice(0, first);
        const nums = header.match(/\d+/g) || [];
        for (let i = 0; i + 1 < nums.length && i / 2 < cnt; i += 2) {
          const on = nums[i], off = parseInt(nums[i + 1], 10);
          const nextOff = i + 3 < nums.length ? parseInt(nums[i + 3], 10) : inner.length;
          objects[on] = inner.slice(first + off, first + nextOff);
        }
      } catch (e) { /* 对象流坏了就跳过它，外面还有常规对象可用 */ }
    }

    /* ② Root → Pages 递归 */
    const rootM = bin.match(/\/Root\s+(\d+)\s+\d+\s+R/);
    if (!rootM) throw new Error('缺 /Root（不是合法 PDF）');
    const pageBodies = [];
    const seen = {};
    const walk = async function (num, depth) {
      if (depth > 32 || seen[num]) return;
      seen[num] = 1;
      const body = objects[num];
      if (!body) return;
      if (/\/Kids\s*\[/.test(body)) {
        const kidsM = body.match(/\/Kids\s*\[([\s\S]*?)\]/);
        if (kidsM) {
          const kids = kidsM[1].match(/(\d+)\s+\d+\s+R/g) || [];
          for (const kd of kids) {
            const kn = (kd.match(/(\d+)/) || [])[1];
            if (kn) await walk(kn, depth + 1);
          }
        }
        return;
      }
      /* 只有带 /Contents 的才是叶子页——Catalog 也没有 Kids，靠 /Pages 引用下钻 */
      if (/\/Contents/.test(body)) { pageBodies.push(body); return; }
      const pagesRef = body.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
      if (pagesRef) await walk(pagesRef[1], depth + 1);
    };
    await walk(rootM[1], 0);
    if (!pageBodies.length) throw new Error('没有页面');

    /* ③ 字体解析：资源名 → {table, width}（每页各自解析，字体对象多为共享引用） */
    const fontCache = {};
    const loadFont = async function (fontObjNum) {
      if (fontCache[fontObjNum]) return fontCache[fontObjNum];
      const fb = objects[fontObjNum];
      let map = null;
      if (fb) {
        const tu = fb.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
        if (tu) {
          const tuBody = objects[tu[1]];
          if (tuBody) {
            try {
              const data = self._streamData(tuBody);
              const cm = await self._inflate(self._bytesOf(data));
              map = self._parseCMap(self._bin(cm));
            } catch (e) { map = null; }
          }
        }
        if (!map) map = self._winAnsiMap();
      }
      fontCache[fontObjNum] = map;
      return map;
    };
    const fontsOf = async function (pageBody) {
      const maps = {};
      let res = pageBody;
      const resRef = pageBody.match(/\/Resources\s+(\d+)\s+\d+\s+R/);
      if (resRef && objects[resRef[1]]) res = objects[resRef[1]];
      const fontSec = /\/Font\s*<<([\s\S]*?)>>/.exec(res);
      let pairs = [];
      if (fontSec) pairs = fontSec[1].match(/\/[\w+.=-]+\s+\d+\s+\d+\s+R/g) || [];
      else {
        const fr = res.match(/\/Font\s+(\d+)\s+\d+\s+R/);
        if (fr && objects[fr[1]]) {
          const fb = objects[fr[1]];
          const inline = /<<([\s\S]*?)>>/.exec(fb);
          if (inline) pairs = inline[1].match(/\/[\w+.=-]+\s+\d+\s+\d+\s+R/g) || [];
        }
      }
      for (const p of pairs) {
        const nm = (p.match(/\/([\w+.=-]+)/) || [])[1];
        const on = (p.match(/(\d+)\s+\d+\s+R/) || [])[1];
        if (nm && on) maps[nm] = await loadFont(on);
      }
      return maps;
    };

    /* ④ 逐页：Contents（可多流、可 Flate）→ 内容流取字 */
    const pageTexts = [];
    for (const pb of pageBodies) {
      const cRefs = [];
      const arrM = pb.match(/\/Contents\s*\[([\s\S]*?)\]/);
      if (arrM) {
        const rs = arrM[1].match(/(\d+)\s+\d+\s+R/g) || [];
        for (const r of rs) cRefs.push((r.match(/(\d+)/) || [])[1]);
      } else {
        const single = pb.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
        if (single) cRefs.push(single[1]);
      }
      if (!cRefs.length) continue;
      const fontMaps = await fontsOf(pb);
      let pageBin = '';
      for (const cn of cRefs) {
        const cb = objects[cn];
        if (!cb) continue;
        const data = self._streamData(cb);
        if (!data) continue;
        try {
          const hasFlate = /\/Filter\s*(\[\s*)?\/FlateDecode/.test(cb) || /\/Filter\s*\/FlateDecode/.test(cb);
          const raw = hasFlate ? await self._inflate(self._bytesOf(data)) : self._bytesOf(data);
          pageBin += self._bin(raw) + '\n';
        } catch (e) { /* 不认识的滤镜（DCT/CCITT 等）跳过该流 */ }
      }
      if (!pageBin) continue;
      const txt = self._contentText(pageBin, fontMaps, self._winAnsiMap());
      if (txt && txt.trim()) pageTexts.push(txt);
    }

    const text = pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('没有可读文本（可能是扫描件或不支持的滤镜）');

    /* ⑤ 书名：/Info → /Title（尽力而为，失败留空） */
    let title = '';
    try {
      const infoM = bin.match(/\/Info\s+(\d+)\s+\d+\s+R/);
      if (infoM && objects[infoM[1]]) {
        const ib = objects[infoM[1]];
        let tm = ib.match(/\/Title\s*\(([\s\S]*?)\)/);
        if (tm) title = tm[1].replace(/\\([()\\])/g, '$1');
        else {
          tm = ib.match(/\/Title\s*<([0-9A-Fa-f\s]+)>/);
          if (tm) {
            let h = tm[1].replace(/\s+/g, '');
            if (h.substr(0, 4).toUpperCase() === 'FEFF') {
              let u = '';
              for (let i = 4; i + 4 <= h.length; i += 4) u += String.fromCharCode(parseInt(h.substr(i, 4), 16));
              title = u;
            } else {
              let raw = '';
              for (let i = 0; i + 1 < h.length; i += 2) raw += String.fromCharCode(parseInt(h.substr(i, 2), 16));
              title = new TextDecoder('windows-1252').decode(new Uint8Array(raw.split('').map(function (c) { return c.charCodeAt(0) & 0xff; })));
            }
          }
        }
      }
    } catch (e) { title = ''; }
    return { title: String(title || '').trim(), text: text };
  },

  /* WinAnsi 单字节回退码表（0-255 逐字节过 windows-1252 解码） */
  _winAnsiMap: function () {
    if (BF.pdf._winCache) return BF.pdf._winCache;
    const td = new TextDecoder('windows-1252');
    const table = {};
    for (let b = 0; b < 256; b++) {
      const s = td.decode(new Uint8Array([b]));
      table[b] = s;
    }
    BF.pdf._winCache = { table: table, width: 1 };
    return BF.pdf._winCache;
  },
};
/* PDF 段结束 */
