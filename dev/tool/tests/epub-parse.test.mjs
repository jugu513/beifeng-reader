/* EPUB 导入回归：手解 zip（store+deflate）→ container.xml → OPF → NCX/nav 目录 → spine 章节纯文本。
   为什么单独立一个文件：EPUB 是字节容器，失败方式很安静——解压错了拿到乱码书、
   目录丢了变成一堆无标题章、实体没解码正文里残留 &amp;——都"能打开"，都不像坏了。
   判据因此必须走完整结构链：两本 fixture（EPUB2 NCX / EPUB3 nav）、跳过 spine 里的图片、
   空章过滤、实体解码、fragment 剥离、sniff 负例，逐条钉死。

   只读母本，不改母本；被测 BF.epub 按标记从母本原样取出（不另抄一份实现）。
   跑法：node tool/tests/epub-parse.test.mjs [--file=<母本>]   退出码 0 = 全过 */
import vm from 'node:vm';
import zlib from 'node:zlib';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();

const SRC = readMaster(FILE);
const ctx = vm.createContext({
  BF: {}, console, JSON, Math, Date, Object, Array, String, Number, Boolean,
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, TextDecoder,
  DecompressionStream, Blob, Response, parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.epub = ' + extract(SRC, 'BF.epub = ', '/* EPUB 段结束 */'), ctx, { filename: 'epub:block' });
const epub = ctx.BF.epub;

/* ── 最小 zip 构造（store 与 deflate 混合；crc32 用 node zlib）── */
function buildZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const store = !!e.store;
    const comp = store ? raw : zlib.deflateRawSync(raw);
    const method = store ? 0 : 8;
    const crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opfOf({ title, creator, manifest, spine }) {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>${creator ? `<dc:creator>${creator}</dc:creator>` : ''}
    <dc:identifier id="uid">fixture-001</dc:identifier>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine toc="ncx">${spine}</spine>
</package>`;
}

/* fixture A：EPUB2 NCX 目录；spine 混入图片与空章；content src 带 fragment */
const FIXTURE_A = buildZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  { name: 'META-INF/container.xml', data: CONTAINER },
  { name: 'OEBPS/content.opf', data: opfOf({
    title: '雪夜行人', creator: '北风',
    manifest:
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
      '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="cover" href="cover.png" media-type="image/png"/>',
    spine: '<itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/><itemref idref="cover"/>',
  }) },
  { name: 'OEBPS/toc.ncx', data: `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>第1章 檐水与长街</text></navLabel><content src="ch1.xhtml"/></navPoint>
  <navPoint id="n2" playOrder="2"><navLabel><text>第2章 炉火</text></navLabel><content src="ch2.xhtml#p2"/></navPoint>
</navMap></ncx>` },
  { name: 'OEBPS/ch1.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title><style>p{margin:0}</style></head>
<body><h1>第1章 檐水与长街</h1><p>他把信纸对折，又展开，<span>字迹已经被指尖磨得模糊了</span>。</p><p>檐下的冰锥滴着水。</p><p><ruby>北<rt>běi</rt>风<rt>fēng</rt></ruby>从巷口拐进来。</p></body></html>` },
  { name: 'OEBPS/ch2.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head>
<body><h1>第2章 炉火</h1><p>茶炉上的水开了&amp;白汽顶得壶盖轻轻跳动。</p><p>他说：&ldquo;今天格外冷&rdquo;&hellip;</p></body></html>` },
  { name: 'OEBPS/ch3.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><body>   </body></html>` },
  { name: 'OEBPS/cover.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), store: true },
]);

/* fixture B：EPUB3 nav 目录（无 NCX），标题取 nav 标签 */
const FIXTURE_B = buildZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  { name: 'META-INF/container.xml', data: CONTAINER },
  { name: 'OEBPS/content.opf', data: `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>风起时</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>` },
  { name: 'OEBPS/nav.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="ch1.xhtml">上篇 · 檐水</a></li><li><a href="ch2.xhtml">下篇 · 炉火</a></li></ol></nav>
</body></html>` },
  { name: 'OEBPS/ch1.xhtml', data: '<html><body><p>北风从巷口拐进来。</p></body></html>' },
  { name: 'OEBPS/ch2.xhtml', data: '<html><body><p>街灯把影子拉得很长。</p></body></html>' },
]);

const t = makeTally();

/* sniff 负正例 */
t.check('sniff: .epub 文件名', epub.sniff(FIXTURE_A, 'book.epub') === true);
t.check('sniff: PK 魔数（无扩展名）', epub.sniff(FIXTURE_A, 'download.bin') === true);
t.check('sniff: 纯文本不误判', epub.sniff(new Uint8Array([0xe5, 0x8c, 0x97, 0xe9a38e].slice(0, 3)), 'a.txt') === false);
t.check('sniff: 空输入安全', epub.sniff(null, '') === false);

/* fixture A 全链路 */
const A = await epub.parse(FIXTURE_A);
t.check('A: dc:title', A.title === '雪夜行人');
t.check('A: dc:creator', A.creator === '北风');
t.check('A: 空章与图片被跳过（2 章）', A.chapters.length === 2);
t.check('A: NCX 标题 + fragment 剥离', A.chapters[1].title === '第2章 炉火');
const a1 = A.chapters[0].content;
t.check('A: 正文抽取（跨标签拼接）', a1.includes('他把信纸对折') && a1.includes('字迹已经被指尖磨得模糊了') && a1.includes('檐下的冰锥滴着水'));
t.check('A: 无标签残留', !a1.includes('<') && !a1.includes('style'));
t.check('A: 实体解码（&amp; → &）', A.chapters[1].content.includes('开了&白汽'));
t.check('A: ruby 注音剥离（只留汉字）', a1.includes('北风从巷口拐进来') && !a1.includes('běi') && !a1.includes('fēng'));
t.check('A: 排版实体（&ldquo;/&hellip; → “/…）', A.chapters[1].content.includes('“今天格外冷”…'));
t.check('A: h1 与 NCX 一致时标题非空', A.chapters[0].title.length > 0);

/* fixture B：nav 目录 */
const B = await epub.parse(FIXTURE_B);
t.check('B: nav 标签作章题', B.chapters.length === 2 && B.chapters[0].title === '上篇 · 檐水' && B.chapters[1].title === '下篇 · 炉火');
t.check('B: 正文', B.chapters[0].content.includes('北风从巷口拐进来'));
t.check('B: 无目录时不至于无标题（标题恒非空）', B.chapters.every((c) => String(c.title || '').trim().length > 0));

/* 坏包必须报错而不是返回垃圾 */
let threw = false;
try { await epub.parse(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])); } catch (e) { threw = true; }
t.check('坏 zip 抛错', threw);

process.exit(t.report('EPUB 导入') ? 0 : 1);
