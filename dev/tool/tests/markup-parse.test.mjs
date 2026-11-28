/* HTML / Markdown / FB2 导入回归（三种「有结构的文本格式」）。
   判据为什么要这么设计：这三种的失败都很安静——HTML 没摘 <head> 会把网页标题
   当正文第一行、导航没剥会把「首页 关于」混进第一章；Markdown 把围栏代码里的 #
   当标题会把一段代码切成一章；FB2 的 XML 声明常写 windows-1251 而文件其实是 UTF-8，
   信声明就把西里尔文解成方块，嵌套 section 还会把同一段正文算两遍。
   fixture 覆盖：编码取舍、头部与导航剥离、h1-h3 分章与整篇回退、
   YAML 头与围栏保护与记号清洗、FB2 声明解码 / 顶层 section / 嵌套不重复 / 无 section 回退。

   只读母本；被测对象按标记取出（BF.library.decodeBuffer 用桩——编码判别本身另有测试）。
   跑法：node tool/tests/markup-parse.test.mjs [--file=<母本>] */
import vm from 'node:vm';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find((x) => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();
const SRC = readMaster(FILE);
const ctx = vm.createContext({
  BF: {
    library: {
      /* 桩：只认 UTF-8。编码判别归 TXT 导入的测试，这里要断言的是结构与清洗。 */
      decodeBuffer: function (buf) {
        return { text: new TextDecoder('utf-8').decode(buf), enc: 'utf-8', confident: true };
      },
      garbleCheck: function () { return { blocked: false, suspect: false, report: '' }; },
      garbleNotice: function () {},
    },
    smart: { chapters: async function (text) { return [{ title: '第1章', content: text }]; } },
  },
  console, JSON, Math, Date, Object, Array, String, Number, Boolean,
  RegExp, Error, Promise, Uint8Array, ArrayBuffer, DataView, TextDecoder,
  DecompressionStream, Blob, Response, parseInt, parseFloat, isNaN, isFinite,
});
vm.runInContext('BF.epub = ' + extract(SRC, 'BF.epub = ', '/* EPUB 段结束 */'), ctx, { filename: 'epub:block' });
vm.runInContext('BF.html = ' + extract(SRC, 'BF.html = ', '/* HTML 段结束 */'), ctx, { filename: 'html:block' });
vm.runInContext('BF.markdown = ' + extract(SRC, 'BF.markdown = ', '/* Markdown 段结束 */'), ctx, { filename: 'md:block' });
vm.runInContext('BF.fb2 = ' + extract(SRC, 'BF.fb2 = ', '/* FB2 段结束 */'), ctx, { filename: 'fb2:block' });
const html = ctx.BF.html;
const md = ctx.BF.markdown;
const fb2 = ctx.BF.fb2;
const t = makeTally();
const utf = (s) => Buffer.from(s, 'utf8');
/* 章数组 → 全文串。直接 chapters.join('') 会把每个对象 toString 成 [object Object]，
   那种「不含 XX」的断言永远为真、等于没测 —— 必须先取 content。 */
const all = (chs) => (chs || []).map((c) => c.title + '\n' + c.content).join('\n');

/* ───────────────────────── HTML ───────────────────────── */
const PAGE = utf(`<!doctype html>
<html><head><meta charset="utf-8"><title>北风起</title>
<style>body{color:red}</style></head>
<body><nav><a href="/">首页</a><a href="/about">关于</a></nav>
<h2>第一章 起风</h2><p>北风刮了一夜。</p>
<h2>第二章 落雪</h2><p>雪落满了肩头。</p>
<footer>版权所有</footer>
</body></html>`);

const H = await html.parse(PAGE);
t.check('H: title 取自 <head>', H.title === '北风起');
t.check('H: 按 h2 分成两章', Array.isArray(H.chapters) && H.chapters.length === 2, JSON.stringify(H.chapters && H.chapters.map((c) => c.title)));
t.check('H: 章题', H.chapters[0].title === '第一章 起风');
t.check('H: 章首行与章题同形（阅读器去重）', H.chapters[0].content.split('\n')[0].trim() === '第一章 起风');
t.check('H: 正文取到', H.chapters[0].content.includes('北风刮了一夜'));
t.check('H: <head> 整段摘掉（样式与标题不进正文）', !H.chapters[0].content.includes('color:red') && !all(H.chapters).includes('北风起'));
t.check('H: <nav> 摘掉（导航不是正文）', !all(H.chapters).includes('首页'));
t.check('H: 没有残留标签', !/<[a-z/]/i.test(all(H.chapters)));

const H1 = await html.parse(utf('<html><head><title>单章</title></head><body><h1>只有一处标题</h1><p>正文。</p></body></html>'));
t.check('H: 标题不足两处 → 整篇回退纯文本', typeof H1.text === 'string' && !H1.chapters);
t.check('H: 回退文本里标题记号已剥', H1.text.includes('只有一处标题') && !/<h1>/i.test(H1.text));

t.check('sniff: .html 扩展名', html.sniff(PAGE, 'a.html') === true);
t.check('sniff: .xhtml', html.sniff(PAGE, 'a.xhtml') === true);
t.check('sniff: zip 不误判成网页', html.sniff(Buffer.from([0x50, 0x4b, 3, 4]), 'x.bin') === false);
t.check('sniff: 无扩展名看内容', html.sniff(utf('<!doctype html><html></html>'), 'download') === true);
t.check('sniff: 纯文本不误判', html.sniff(utf('just some plain text here'), 'a.txt') === false);

/* ───────────────────────── Markdown ───────────────────────── */
const DOC = utf(`---
title: 雪夜行人
---

# 雪夜行人

## 第一章 起风

北风刮了一夜，**行人**低着头赶路。见[说明](http://x/y)。

## 第二章 落雪

\`\`\`js
# 这行是代码，不是标题
const a = 1;
\`\`\`

- 第一条
- 第二条
`);

const M = await md.parse(DOC);
t.check('M: YAML 头的 title 当书名', M.title === '雪夜行人');
t.check('M: 按 ## 分成两章', Array.isArray(M.chapters) && M.chapters.length === 2, JSON.stringify(M.chapters && M.chapters.map((c) => c.title)));
t.check('M: 章题不带 #', M.chapters[0].title === '第一章 起风');
t.check('M: 粗体记号洗掉', M.chapters[0].content.includes('行人') && !M.chapters[0].content.includes('**'));
t.check('M: 链接留文字不留地址', M.chapters[0].content.includes('说明') && !M.chapters[0].content.includes('http://x/y'));
t.check('M: 围栏里的 # 不是标题', M.chapters.length === 2 && M.chapters[1].content.includes('这行是代码') && M.chapters[1].content.includes('const a = 1'));
t.check('M: 列表记号洗掉', !/^- /m.test(M.chapters[1].content) && M.chapters[1].content.includes('第一条'));

const M2 = await md.parse(utf('# 书名\n\n只有书名这一个标题，正文跟在后面。'));
t.check('M: 单个 # 当书名且不出假章', M2.title === '书名' && (M2.chapters ? M2.chapters.length === 1 && M2.chapters[0].content.includes('正文跟在后面') : !!M2.text), JSON.stringify(M2));

const M3 = await md.parse(utf('没有标题的散文。\n\n分两段。'));
t.check('M: 无标题整篇回退', typeof M3.text === 'string' && !M3.chapters);

t.check('sniff: .md', md.sniff(utf('# x'), 'a.md') === true);
t.check('sniff: .markdown', md.sniff(utf('# x'), 'a.markdown') === true);
t.check('sniff: 纯文本不误判', md.sniff(utf('plain text'), 'a.txt') === false);

/* ───────────────────────── FB2 ───────────────────────── */
const FB2 = utf(`<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fb2/fb2">
<description><title-info><book-title>雪夜行人</book-title></title-info></description>
<body>
<section><title><p>第一章 起风</p></title>
<p>北风刮了一夜。</p>
<section><title><p>嵌套小节</p></title><p>嵌套里的这一段只应出现一次。</p></section>
</section>
<section><title><p>第二章 落雪</p></title><p>雪落满了肩头。</p></section>
</body>
</FictionBook>`);

const F = await fb2.parse(FB2);
t.check('F: book-title 当书名', F.title === '雪夜行人');
t.check('F: 顶层 section 两章（嵌套不另起章）', Array.isArray(F.chapters) && F.chapters.length === 2, JSON.stringify(F.chapters && F.chapters.map((c) => c.title)));
t.check('F: 章题来自 <title>', F.chapters[0].title === '第一章 起风');
t.check('F: 嵌套段并进父章且只出现一次', F.chapters[0].content.includes('嵌套里的这一段只应出现一次') &&
  all(F.chapters).split('嵌套里的这一段').length === 2, '出现次数=' + all(F.chapters).split('嵌套里的这一段').length);
t.check('F: 正文取到', F.chapters[1].content.includes('雪落满了肩头'));
t.check('F: 标签已剥', !/<p>/.test(all(F.chapters)));

/* 声明 windows-1251 但内容不是合法 UTF-8 → 必须按声明解，不能解成方块 */
const RU = Buffer.concat([
  utf('<?xml version="1.0" encoding="windows-1251"?>'),
  utf('<FictionBook><description><title-info><book-title>'),
  Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),   /* Привет in cp1251 */
  utf('</book-title></title-info></description><body><section><title><p>'),
  Buffer.from([0xc3, 0xeb, 0xe0, 0xe2, 0xe0]),          /* Глава in cp1251 */
  utf('</p></title><p>'),
  Buffer.from([0xd2, 0xe5, 0xea, 0xf1, 0xf2]),          /* Текст in cp1251 */
  utf('</p></section></body></FictionBook>'),
]);
const FR = await fb2.parse(RU);
t.check('F: windows-1251 按声明解码', FR.title === 'Привет' && FR.chapters[0].title === 'Глава' && FR.chapters[0].content.includes('Текст'), JSON.stringify([FR.title, FR.chapters && FR.chapters[0] && FR.chapters[0].title]));

const FZ = await fb2.parse(Buffer.concat([
  (() => {
    /* .fb2.zip：zip 里塞一个 .fb2 */
    const crc32 = (bytes) => { let c; const tbl = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })(); let crc = 0xffffffff; for (let i = 0; i < bytes.length; i++) crc = tbl[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
    const data = FB2, name = Buffer.from('book.fb2', 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    const cd = Buffer.concat([ch, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(lh.length + name.length + data.length, 16);
    return Buffer.concat([lh, name, data, cd, eocd]);
  })(),
]));
t.check('F: .fb2.zip 解包', FZ.title === '雪夜行人' && FZ.chapters.length === 2);

const FLAT = await fb2.parse(utf('<FictionBook><description><title-info><book-title>散装</book-title></title-info></description><body><p>没有 section 的一段。</p></body></FictionBook>'));
t.check('F: 无 section 回退纯文本', typeof FLAT.text === 'string' && !FLAT.chapters && FLAT.text.includes('没有 section 的一段'));

let threw = false;
try { await fb2.parse(utf('<html><body>不是 FB2</body></html>')); } catch (e) { threw = /FictionBook/.test(e.message); }
t.check('F: 非 FB2 如实报错', threw);

t.check('sniff: .fb2 扩展名', fb2.sniff(FB2, 'a.fb2') === true);
t.check('sniff: .fb2.zip 扩展名', fb2.sniff(Buffer.from([0x50, 0x4b]), 'a.fb2.zip') === true);
t.check('sniff: 内容认 <FictionBook>', fb2.sniff(FB2, 'download') === true);
t.check('sniff: 纯文本不误判', fb2.sniff(utf('plain text here'), 'a.txt') === false);

process.exit(t.report('HTML / Markdown / FB2 导入') ? 0 : 1);
