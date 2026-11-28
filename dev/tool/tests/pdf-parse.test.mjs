/* PDF 文本抽取回归：对象扫描 → ObjStm 展开 → Pages 递归 → Flate 流 → 内容流取字 → ToUnicode。
   判据为什么要这么设计：PDF 的失败同样很安静——滤镜不对会跳流（无字）、CMap 解错会出乱码、
   对象扫描漏了 ObjStm 会整页消失。fixture 覆盖三条主路：经典无压缩 + WinAnsi、
   Flate + Identity-H + ToUnicode 中文、ObjStm 对象流；外加扫描件拒收与 sniff 正反例。

   只读母本；被测 BF.pdf 按标记取出。
   跑法：node tool/tests/pdf-parse.test.mjs [--file=<母本>] */
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
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, DataView, TextDecoder,
  DecompressionStream, Blob, Response, parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.pdf = ' + extract(SRC, 'BF.pdf = ', '/* PDF 段结束 */'), ctx, { filename: 'pdf:block' });
const pdf = ctx.BF.pdf;

const str = function (s) { return Buffer.from(s, 'latin1'); };

/* ── fixture A：经典结构、无压缩、WinAnsi、两页、/Info 标题 ── */
function fixtureA() {
  return Buffer.concat([
    str('%PDF-1.4\n'),
    str('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    str('2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n'),
    str('3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj\n'),
    str('4 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >> endobj\n'),
    str('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n'),
    str('6 0 obj << /Length 99 >> stream\nBT /F1 12 Tf 72 720 Td (Chapter 1: The Wind) Tj T* (It was a cold and windy night.) Tj ET\nendstream endobj\n'),
    str('7 0 obj << /Length 99 >> stream\nBT /F1 12 Tf 72 720 Td (Chapter 2: The Road) Tj T* (She walked on.) Tj ET\nendstream endobj\n'),
    str('9 0 obj << /Title (My Test Book) >> endobj\n'),
    str('trailer << /Root 1 0 R /Info 9 0 R >>\n'),
  ]);
}

const CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
8 beginbfchar
<4E2D> <4E2D>
<6587> <6587>
<FF0C> <FF0C>
<4F60> <4F60>
<597D> <597D>
<5370> <5370>
<5237> <5237>
<4EF6> <4EF6>
endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end
`;

/* ── fixture B：FlateDecode 内容流 + Type0/Identity-H + ToUnicode 中文 ── */
function fixtureB() {
  const content = 'BT /F1 14 Tf 72 720 Td <4E2D><6587><FF0C><4F60><597D> Tj T* <5370><5237><4EF6> Tj ET';
  const cBuf = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const cmBuf = zlib.deflateSync(Buffer.from(CMAP, 'utf8'));
  return Buffer.concat([
    str('%PDF-1.5\n'),
    str('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    str('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'),
    str('3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj\n'),
    str('5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /Identity-H /ToUnicode 7 0 R >> endobj\n'),
    str('6 0 obj << /Length ' + cBuf.length + ' /Filter /FlateDecode >> stream\n'),
    cBuf,
    str('\nendstream endobj\n'),
    str('7 0 obj << /Length ' + cmBuf.length + ' /Filter /FlateDecode >> stream\n'),
    cmBuf,
    str('\nendstream endobj\n'),
    str('trailer << /Root 1 0 R >>\n'),
  ]);
}

/* ── fixture C：Catalog/Pages 藏在 ObjStm 对象流里 ── */
function fixtureC() {
  const body1 = '<< /Type /Catalog /Pages 2 0 R >>';
  const body2 = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const header = '1 0 2 ' + body1.length + ' ';
  const stm = zlib.deflateSync(Buffer.from(header + body1 + body2, 'latin1'));
  return Buffer.concat([
    str('%PDF-1.6\n'),
    str('8 0 obj << /Type /ObjStm /N 2 /First ' + header.length + ' /Length ' + stm.length + ' /Filter /FlateDecode >> stream\n'),
    stm,
    str('\nendstream endobj\n'),
    str('3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj\n'),
    str('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n'),
    str('6 0 obj << /Length 99 >> stream\nBT /F1 12 Tf 72 720 Td (Object stream text works.) Tj ET\nendstream endobj\n'),
    str('trailer << /Root 1 0 R >>\n'),
  ]);
}

/* ── fixture D：扫描件——有页有流但一个字都没有 ── */
function fixtureD() {
  return Buffer.concat([
    str('%PDF-1.4\n'),
    str('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    str('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'),
    str('3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj\n'),
    str('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'),
    str('6 0 obj << /Length 20 >> stream\nq 10 0 0 10 0 0 cm /Im0 Do Q\nendstream endobj\n'),
    str('trailer << /Root 1 0 R >>\n'),
  ]);
}

const t = makeTally();

t.check('sniff: .pdf 扩展名', pdf.sniff(fixtureA(), 'x.pdf') === true);
t.check('sniff: %PDF 魔数', pdf.sniff(fixtureA(), 'download.bin') === true);
t.check('sniff: 文本不误判', pdf.sniff(Buffer.from('hello'), 'a.txt') === false);

const A = await pdf.parse(fixtureA());
t.check('A: /Info 标题', A.title === 'My Test Book');
t.check('A: 第一页正文', A.text.includes('Chapter 1: The Wind') && A.text.includes('cold and windy night'));
t.check('A: 第二页正文', A.text.includes('Chapter 2: The Road') && A.text.includes('She walked on'));

const B = await pdf.parse(fixtureB());
t.check('B: Flate+ToUnicode 中文解码', B.text.includes('中文，你好'));
t.check('B: 第二行', B.text.includes('印刷件'));

const C = await pdf.parse(fixtureC());
t.check('C: ObjStm 内层对象被解析', C.text.includes('Object stream text works'));

let threw = false;
try { await pdf.parse(fixtureD()); } catch (e) { threw = /没有可读文本/.test(e.message); }
t.check('D: 扫描件如实报错', threw);

threw = false;
try { await pdf.parse(Buffer.from('not a pdf at all........')); } catch (e) { threw = true; }
t.check('坏文件报错', threw);

process.exit(t.report('PDF 文本抽取') ? 0 : 1);
