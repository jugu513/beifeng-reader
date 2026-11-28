/* 导入格式注册表 + DOCX 导入回归。
   判据为什么要这么设计：注册表的失败很安静——嗅探顺序错一位，.docx 会被 EPUB 的
   PK 魔数认领走，用户看到的是「不是 EPUB」而不是「解不了 docx」；标签映射漏一处，
   进度条写 PDF 实际在解 HTML。DOCX 的失败同样安静——标题样式没认出来会把整本书
   压成一章、<w:p/> 空段没跳过会凭空多出空章、<w:t> 之外的换行记号丢了会把两段
   拼成一段。所以 fixture 覆盖：嗅探顺序、标签、分章收口、标题样式分章、
   空段与内联记号、无标题回退、坏文件拒收。

   只读母本；被测对象按标记取出（依赖 BF.epub / BF.mobi / BF.pdf 同法取出）。
   跑法：node tool/tests/docx-parse.test.mjs [--file=<母本>] */
import vm from 'node:vm';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();
const SRC = readMaster(FILE);

/* 分章器与乱码判据在此只做桩：分章数学归 splitChapters 自己的测试管，
   这里要断言的是「结构产物直通 / 纯文本才进分章器 / 空产物如实报错」这条收口逻辑。 */
const ctx = vm.createContext({
  BF: {
    library: {
      garbleCheck: function () { return { blocked: false, suspect: false, report: '' }; },
      garbleNotice: function () { ctx.__garbleNotice = (ctx.__garbleNotice || 0) + 1; },
    },
    smart: {
      chapters: async function (text) { ctx.__smartCalls = (ctx.__smartCalls || 0) + 1; return [{ title: '第1章', content: text }]; },
    },
  },
  console, JSON, Math, Date, Object, Array, String, Number, Boolean,
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, DataView, TextDecoder,
  DecompressionStream, Blob, Response, parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.epub = ' + extract(SRC, 'BF.epub = ', '/* EPUB 段结束 */'), ctx, { filename: 'epub:block' });
vm.runInContext('BF.mobi = ' + extract(SRC, 'BF.mobi = ', '/* MOBI 段结束 */'), ctx, { filename: 'mobi:block' });
vm.runInContext('BF.pdf = ' + extract(SRC, 'BF.pdf = ', '/* PDF 段结束 */'), ctx, { filename: 'pdf:block' });
vm.runInContext('BF.docx = ' + extract(SRC, 'BF.docx = ', '/* DOCX 段结束 */'), ctx, { filename: 'docx:block' });
vm.runInContext('BF.fb2 = ' + extract(SRC, 'BF.fb2 = ', '/* FB2 段结束 */'), ctx, { filename: 'fb2:block' });
vm.runInContext('BF.cbz = ' + extract(SRC, 'BF.cbz = ', '/* CBZ 段结束 */'), ctx, { filename: 'cbz:block' });
vm.runInContext('BF.fmt = ' + extract(SRC, 'BF.fmt = ', '/* 导入格式注册表 段结束 */'), ctx, { filename: 'fmt:block' });
const fmt = ctx.BF.fmt;
const docx = ctx.BF.docx;

/* ── zip（stored）构造器：与 epub 测试同法，手搓字节、零依赖 ── */
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
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, nb, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
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
const utf = (s) => Buffer.from(s, 'utf8');

/* ── DOCX fixture：两个 Heading1、一个空段、dc:title 元数据 ── */
function fixtureDocx() {
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>雪夜行人</w:t></w:r></w:p>' +
    '<w:p/>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 起风</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">北风刮了</w:t><w:tab/><w:t>一夜。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>檐下的冰锥</w:t><w:br/><w:t>滴着水。</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第二章 落雪</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>雪落满了肩头。</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  return buildZip([
    ['[Content_Types].xml', utf('<?xml version="1.0"?><Types/>')],
    ['word/document.xml', utf(doc)],
    ['docProps/core.xml', utf('<?xml version="1.0"?><cp:coreProperties xmlns:cp="x"><dc:title>北风</dc:title></cp:coreProperties>')],
  ]);
}

/* ── 无标题样式的 DOCX：应整篇回退成纯文本 ── */
function fixtureFlat() {
  const doc = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>没有标题样式的一篇。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>两段而已。</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  return buildZip([['word/document.xml', utf(doc)]]);
}

const t = makeTally();

/* ── 嗅探顺序：PK 魔数会被 EPUB 认领，扩展名明确的必须排在它前面 ── */
const PK = Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]);
t.check('fmt.sniff: .docx 不被 EPUB 认领', fmt.sniff(PK, 'book.docx') === 'docx');
t.check('fmt.sniff: .cbz 不被 EPUB 认领', fmt.sniff(PK, 'comic.cbz') === 'cbz');
t.check('fmt.sniff: .fb2.zip 先于 EPUB', fmt.sniff(PK, 'book.fb2.zip') === 'fb2');
t.check('fmt.sniff: .epub 仍归 EPUB', fmt.sniff(PK, 'book.epub') === 'epub');
t.check('fmt.sniff: 无名 zip 兜底成 EPUB', fmt.sniff(PK, 'download.bin') === 'epub');
t.check('fmt.sniff: 纯文本不认', fmt.sniff(Buffer.from('hello world'), 'a.txt') === '');
t.check('fmt.label: DOCX', fmt.label('docx') === 'DOCX');
t.check('fmt.label: 未知格式大写兜底', fmt.label('xyz') === 'XYZ');

/* ── DOCX 解析 ── */
const A = await docx.parse(fixtureDocx());
t.check('A: dc:title 兜底书名', A.title === '北风');
t.check('A: 按 Heading1 分成两章', Array.isArray(A.chapters) && A.chapters.length === 2, JSON.stringify(A.chapters && A.chapters.map((c) => c.title)));
t.check('A: 章题取标题行', A.chapters[0].title === '第一章 起风' && A.chapters[1].title === '第二章 落雪');
t.check('A: 标题行留在章首（阅读器去重）', A.chapters[0].content.split('\n')[0] === '第一章 起风');
t.check('A: 正文取到', A.chapters[0].content.includes('北风刮了') && A.chapters[0].content.includes('檐下的冰锥'));
t.check('A: <w:tab/> 还原成空格', A.chapters[0].content.includes('北风刮了 一夜'));
t.check('A: <w:br/> 还原成换行', A.chapters[0].content.includes('冰锥\n滴着水'));
t.check('A: 空段 <w:p/> 不产空章', A.chapters.every((c) => c.content.trim().length > 0));
t.check('A: Title 样式不被当章切开', !A.chapters.some((c) => c.title === '雪夜行人'));

const B = await docx.parse(fixtureFlat());
t.check('B: 无标题样式回退纯文本', typeof B.text === 'string' && !B.chapters, JSON.stringify(Object.keys(B)));
t.check('B: 两段都在', B.text.includes('没有标题样式的一篇') && B.text.includes('两段而已'));

let threw = false;
try { await docx.parse(buildZip([['word/styles.xml', utf('<w:styles/>')]])); }
catch (e) { threw = /word\/document\.xml/.test(e.message); }
t.check('缺 document.xml 如实报错', threw);

threw = false;
try { await docx.parse(Buffer.from('not a zip at all......')); } catch (e) { threw = true; }
t.check('坏文件报错', threw);

t.check('sniff: .docx 扩展名', docx.sniff(fixtureDocx(), 'x.docx') === true);
t.check('sniff: 纯文本不误判', docx.sniff(Buffer.from('hello'), 'a.txt') === false);

/* ── chapterize 收口：结构产物直通、纯文本才进分章器、空产物如实报错 ── */
ctx.__smartCalls = 0;
const direct = await fmt.chapterize('docx', { chapters: [{ title: '一', content: 'x' }, { title: '二', content: 'y' }] }, '文件');
t.check('chapterize: 结构产物直通', direct.length === 2 && ctx.__smartCalls === 0, 'smartCalls=' + ctx.__smartCalls);
const viaText = await fmt.chapterize('mobi', { text: '一段正文' }, '文件');
t.check('chapterize: 纯文本进统一分章器', ctx.__smartCalls === 1 && viaText[0].content === '一段正文', 'smartCalls=' + ctx.__smartCalls);
threw = false;
try { await fmt.chapterize('mobi', { text: '' }, '文件'); } catch (e) { threw = /没有可读正文/.test(e.message); }
t.check('chapterize: 空产物报「没有可读正文」', threw);
const withImg = await fmt.chapterize('cbz', { chapters: [{ title: '第 1 页', content: '', img: 'data:image/png;base64,AA' }] }, '文件');
t.check('chapterize: 图片章靠 img 字段认（空正文也放行）', withImg.length === 1 && !!withImg[0].img);

process.exit(t.report('导入格式注册表 + DOCX') ? 0 : 1);
