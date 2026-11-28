/* CBZ 图片书导入回归。
   判据为什么要这么设计：CBZ 的失败同样很安静——排序用错字典序，页码 p10 会排到
   p2 前面（整本乱页且不报错）；垃圾条目没滤，__MACOSX 的 ._p1.png 会变成
   「第 1 页」；图片塞进正文槽，搜索/朗读/AI 会去啃几十万字符的 base64。
   fixture 覆盖：自然排序、垃圾过滤、mime 与 dataURL 形态、空正文槽、
   无图片拒收、与 EPUB 的嗅探边界。

   只读母本；被测 BF.cbz 按标记取出（依赖 BF.epub._unzip，同法取出）。
   跑法：node tool/tests/cbz-parse.test.mjs [--file=<母本>] */
import vm from 'node:vm';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();
const SRC = readMaster(FILE);
const ctx = vm.createContext({
  BF: {},
  console, JSON, Math, Date, Object, Array, String, Number, Boolean,
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, DataView, TextDecoder,
  DecompressionStream, Blob, Response, btoa,
  parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.epub = ' + extract(SRC, 'BF.epub = ', '/* EPUB 段结束 */'), ctx, { filename: 'epub:block' });
vm.runInContext('BF.cbz = ' + extract(SRC, 'BF.cbz = ', '/* CBZ 段结束 */'), ctx, { filename: 'cbz:block' });
const cbz = ctx.BF.cbz;

function crc32(bytes) {
  let c;
  const tbl = crc32.tbl || (crc32.tbl = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = tbl[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(entries) {
  const local = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const nb = Buffer.from(name, 'utf8');
    const c = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    local.push(lh, nb, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb);
    off += lh.length + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, eocd]);
}

/* 最小 PNG 头 + 尾：够当「一张图」，base64 往返断言也用它 */
function png(tag) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag, 'utf8')]);
}

const t = makeTally();

/* ── 页码乱序 + 垃圾条目 + 非图片条目 ── */
const FIX = buildZip([
  ['p10.png', png('ten')],
  ['__MACOSX/._p1.png', png('junk')],
  ['p2.png', png('two')],
  ['p1.jpg', png('one')],
  ['.hidden.png', png('hidden')],
  ['readme.txt', Buffer.from('这不是图片', 'utf8')],
]);

const A = await cbz.parse(FIX);
t.check('A: 图片全收（txt 不算图）', A.chapters.length === 3, '实得 ' + A.chapters.length);
const titles = A.chapters.map((c) => c.title);
t.check('A: 自然排序 p1 < p2 < p10（纯字典序会把 p10 排到 p2 前）', titles.join(',') === '第 1 页,第 2 页,第 3 页', titles.join(','));
t.check('A: __MACOSX 与点开头的垃圾被滤掉', A.chapters.length === 3 && !A.chapters.some((c) => /hidden|junk/.test(Buffer.from(c.img.split(',')[1], 'base64').toString('latin1'))));
t.check('A: 正文槽留空（图片不进正文，搜索/朗读才不会啃 base64）', A.chapters.every((c) => c.content === ''));
t.check('A: img 是 dataURL 且 mime 对', A.chapters[0].img.indexOf('data:image/jpeg;base64,') === 0 &&
  A.chapters[1].img.indexOf('data:image/png;base64,') === 0);
t.check('A: base64 能还原原字节', Buffer.from(A.chapters[2].img.split(',')[1], 'base64').toString('utf8').includes('ten'));
t.check('A: 书名取自首图文件名', A.title === 'p1', JSON.stringify(A.title));

const W = await cbz.parse(buildZip([['a.webp', png('w')]]));
t.check('A: webp 的 mime', W.chapters[0].img.indexOf('data:image/webp;base64,') === 0);

/* ── 只有非图片条目 → 如实报错 ── */
let threw = false;
try { await cbz.parse(buildZip([['readme.txt', Buffer.from('只有文本', 'utf8')]])); }
catch (e) { threw = /没有图片/.test(e.message); }
t.check('无图片如实报错', threw);

threw = false;
try { await cbz.parse(Buffer.from('not a zip at all......')); } catch (e) { threw = true; }
t.check('坏文件报错', threw);

/* ── 嗅探：.cbz 才认；PK 魔数归 EPUB，不与 BF.epub 抢 ── */
t.check('sniff: .cbz 扩展名', cbz.sniff(FIX, 'comic.cbz') === true);
t.check('sniff: 同样字节叫 .epub 不认成 CBZ', cbz.sniff(FIX, 'book.epub') === false);
t.check('sniff: 纯文本不误判', cbz.sniff(Buffer.from('hello'), 'a.txt') === false);

/* ── 自然排序单独验：纯字典序会把 p10 排到 p2 前 ── */
const order = ['p10.png', 'p2.png', 'p1.png'].slice().sort(function (a, b) { return cbz._nat(a, b); });
t.check('_nat: 数字按数值比', order.join(',') === 'p1.png,p2.png,p10.png', order.join(','));

process.exit(t.report('CBZ 图片书导入') ? 0 : 1);
