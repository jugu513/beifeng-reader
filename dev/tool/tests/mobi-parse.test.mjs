/* MOBI/AZW3 导入回归：PalmDB 记录表 → record0 头解析 → 尾随裁剪 → PalmDOC LZ77 → 解码。
   判据为什么要这么设计：这个格式的失败很安静——偏移错一位照样能出字（乱码）、
   解压分支漏一个照样能出字（缺段）、尾随裁剪漏掉会把 TBS 垃圾混进正文。
   所以 fixture 覆盖：字面量/字节对/距离长度对三种压缩分支、EXTH 元数据、
   尾随数据（extraDataFlags）、无 MOBI 头的老 PalmDOC（编码嗅探）、加密与 HUFF 拒收。

   只读母本；被测 BF.mobi 按标记取出（依赖 BF.epub._html2Text，同法取出）。
   跑法：node tool/tests/mobi-parse.test.mjs [--file=<母本>] */
import vm from 'node:vm';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();
const SRC = readMaster(FILE);
const ctx = vm.createContext({
  BF: {}, console, JSON, Math, Date, Object, Array, String, Number, Boolean,
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, DataView, TextDecoder,
  DecompressionStream, Blob, Response, parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.epub = ' + extract(SRC, 'BF.epub = ', '/* EPUB 段结束 */'), ctx, { filename: 'epub:block' });
vm.runInContext('BF.mobi = ' + extract(SRC, 'BF.mobi = ', '/* MOBI 段结束 */'), ctx, { filename: 'mobi:block' });
const mobi = ctx.BF.mobi;

/* ── PalmDOC 压缩器（测试侧）：把文本按 ≤8 字面量成组编码——合法流，解压端必须逐字还原 ── */
function compressLiterals(text) {
  const raw = Buffer.from(text, 'utf8');
  const out = [];
  for (let i = 0; i < raw.length; i += 8) {
    const chunk = raw.subarray(i, i + 8);
    out.push(chunk.length, ...chunk);
  }
  return Buffer.from(out);
}

/* ── PalmDB 构造：头 78B + 记录表 + 记录体 ── */
function buildPdb({ name, type, creator, records }) {
  const nameBuf = Buffer.alloc(32);
  nameBuf.write(name.slice(0, 31), 0, 'utf8');
  const num = records.length;
  const tableEnd = 78 + num * 8;
  const offs = [];
  let cursor = tableEnd;
  for (const r of records) { offs.push(cursor); cursor += r.length; }
  const head = Buffer.alloc(78);
  nameBuf.copy(head, 0);
  head.write(type, 60, 'latin1');
  head.write(creator, 64, 'latin1');
  head.writeUInt16BE(num, 76);
  const table = Buffer.alloc(num * 8);
  offs.forEach((o, i) => table.writeUInt32BE(o, i * 8));
  return Buffer.concat([head, table, ...records]);
}

/* ── record0：PalmDOC 头 + MOBI 头（headerLen=228）+ EXTH + 全名 ── */
function buildRec0({ compression = 2, textRecCount, encoding = 65001, extraFlags = 0, exth = [], fullName = '' }) {
  const r0 = Buffer.alloc(244);
  r0.writeUInt16BE(compression, 0);
  r0.writeUInt32BE(0, 4);
  r0.writeUInt16BE(textRecCount, 8);
  r0.writeUInt16BE(4096, 10);
  r0.writeUInt16BE(0, 12);
  r0.write('MOBI', 16, 'latin1');
  r0.writeUInt32BE(228, 20);
  r0.writeUInt32BE(2, 24);
  r0.writeUInt32BE(encoding, 28);
  r0.writeUInt32BE(0xffffffff, 108);
  r0.writeUInt32BE(0x40, 128);
  r0.writeUInt32BE(extraFlags, 240);

  const exthParts = [];
  let exthDataLen = 12;
  for (const [t, val] of exth) {
    const data = Buffer.from(val, 'utf8');
    const rec = Buffer.alloc(8 + data.length);
    rec.writeUInt32BE(t, 0);
    rec.writeUInt32BE(8 + data.length, 4);
    data.copy(rec, 8);
    exthParts.push(rec);
    exthDataLen += rec.length;
  }
  const pad = (4 - (exthDataLen % 4)) % 4;
  const head12 = Buffer.alloc(12);
  head12.write('EXTH', 0, 'latin1');
  head12.writeUInt32BE(exthDataLen, 4);
  head12.writeUInt32BE(exth.length, 8);
  const exthBuf = Buffer.concat([head12, ...exthParts, Buffer.alloc(pad)]);
  return Buffer.concat([r0, exthBuf, Buffer.from(fullName, 'utf8')]);
}

/* ── fixture A：compression=2（混合压缩流）+ EXTH 标题作者 + 尾随数据 ── */
function fixtureA() {
  const compressed = Buffer.concat([
    Buffer.from([0x08]), Buffer.from('<p>abc A', 'latin1'),
    Buffer.from([0x80, 0x18]),
    Buffer.from([0xe1]), /* 字节对放行中：行首空格会被压空白裁掉，断言才踩得到真值 */
    compressLiterals('</p><p>檐下的冰锥滴着水。</p>'),
  ]);
  const rec0 = buildRec0({
    compression: 2, textRecCount: 1, encoding: 65001,
    exth: [[100, '北风'], [503, '雪夜行人']], fullName: '全名兜底书',
  });
  const rec0Final = Buffer.from(rec0);
  rec0Final.writeUInt32BE(0b10, 240);
  const rec1 = Buffer.concat([compressed, Buffer.from('XY', 'latin1'), Buffer.from([0x83])]);
  return buildPdb({ name: 'fixtureA', type: 'BOOK', creator: 'MOBI', records: [rec0Final, rec1] });
}

/* ── fixture B：无 MOBI 头的老 PalmDOC（TEXtREAd），无压缩 + UTF-8 ── */
function fixtureB() {
  const r0 = Buffer.alloc(16);
  r0.writeUInt16BE(1, 0);
  r0.writeUInt16BE(1, 8);
  r0.writeUInt16BE(4096, 10);
  const text = Buffer.from('<h1>老掌上书</h1><p>没有 MOBI 头，也能靠编码嗅探读出来。</p>', 'utf8');
  return buildPdb({ name: '老掌上书', type: 'TEXt', creator: 'REAd', records: [r0, text] });
}

const t = makeTally();

t.check('sniff: .mobi 扩展名', mobi.sniff(fixtureA(), 'x.mobi') === true);
t.check('sniff: BOOKMOBI 魔数', mobi.sniff(fixtureA(), 'download.bin') === true);
t.check('sniff: TEXtREAd 魔数', mobi.sniff(fixtureB(), 'old.pdb') === true);
t.check('sniff: 纯文本不误判', mobi.sniff(Buffer.from('hello'), 'a.txt') === false);

const A = await mobi.parse(fixtureA());
t.check('A: EXTH 标题优先', A.title === '雪夜行人');
t.check('A: EXTH 作者', A.creator === '北风');
t.check('A: 字面量与距离对还原', A.text.includes('abc Ac A'));
t.check('A: 中文正文', A.text.includes('檐下的冰锥滴着水'));
t.check('A: 字节对分支（空格+字母）', A.text.includes(' a'));
t.check('A: 标签已剥', !A.text.includes('<p') && !A.text.includes('</p'));
t.check('A: 尾随数据未混入正文', !A.text.includes('XY'));

const B = await mobi.parse(fixtureB());
t.check('B: PDB 库名兜底标题', B.title === '老掌上书');
t.check('B: 无压缩正文', B.text.includes('没有 MOBI 头，也能靠编码嗅探读出来'));

const encRec0 = buildRec0({ compression: 2, textRecCount: 1 });
encRec0.writeUInt16BE(2, 12);
let threw = false;
try {
  await mobi.parse(buildPdb({ name: 'enc', type: 'BOOK', creator: 'MOBI', records: [encRec0, Buffer.from('x')] }));
} catch (e) { threw = /DRM/.test(String(e.message)); }
t.check('加密文件报 DRM 错', threw);

threw = false;
try {
  await mobi.parse(buildPdb({
    name: 'huff', type: 'BOOK', creator: 'MOBI',
    records: [buildRec0({ compression: 17480, textRecCount: 1 }), Buffer.from('x')],
  }));
} catch (e) { threw = /HUFF/.test(String(e.message)); }
t.check('HUFF/CDIC 报不支持', threw);

process.exit(t.report('MOBI/AZW3 导入') ? 0 : 1);
