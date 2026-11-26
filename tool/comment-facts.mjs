/* 只读诊断：注释与代码是否还相符。
   做法：把注释正文挖空得到「纯代码」，再从每条注释里抽出它点名的代码符号
   （BF.a.b / foo() / 'someKey'），逐个在纯代码里找。找不到的 = 注释在说一件
   代码里已经不存在的事 —— 这类假注释比没注释更坏，因为它会指挥下一个人做错事。
   用法：node tool/comment-facts.mjs [母本路径] */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TARGET, ROOT } from './patch.mjs';

const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const codeOnly = execFileSync(process.execPath, [path.join(ROOT, 'tool', 'strip-comments.mjs'), FILE], { maxBuffer: 1 << 28 }).toString();

const lineAt = (i) => src.slice(0, i).split('\n').length;
const hits = [];
const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
let m;
while ((m = re.exec(src))) {
  const text = m[0];
  if (text.length < 8) continue;
  const toks = new Set();
  for (const t of text.matchAll(/\bBF\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g)) toks.add(t[0]);
  for (const t of text.matchAll(/\b([A-Za-z_$][\w$]{3,})\(\)/g)) toks.add(t[1] + '()');
  for (const t of (text.match(/'([A-Za-z_$][\w$]{4,})'/g) || []).join(' ').matchAll(/'([A-Za-z_$][\w$]{4,})'/g)) toks.add(t[1]);
  /* 判据要分开看：`BF.heal.repairOrphans` 这种全路径几乎不会原样出现在代码里
     （定义处是 BF.heal = (…return { repairOrphans })），整串比对会把每条链式引用都误报。
     所以查两段：末级名必须存在，命名空间根（BF.x）也必须存在。 */
  /* 2026-11-25 假阳性守卫：注释里点名的符号有两种身份——①「代码真有这个符号，
     否则注释指挥人做错事」（要报）；②「反例/示例：误写成 X 会怎样、X 不是真名、
     真名带前缀 y、X 不在 DEFAULTS 里、被服务端忽略」（X 本就不该存在于代码里，
     报了才是噪音）。一条注释是单一语义单元：整条带反例信号，则该条点名的符号
     都属身份②，全跳过。真失实的注释（在讲真符号却写错了名）不含这些信号，照报。 */
  const NEG = /误写|写错|错写|写成的?|不是真|不存在|不在.{0,12}里|不该|别写|形如|例如|比如|反例|假精确|而不是|非真|字面|示意|占位|举[例个]|拿它当|当成|对不上|会抛|被忽略|忽略|仍\s*\d+\s*返回|真的?名|带.{0,6}前缀|真名|挡住密钥|整体禁掉/;
  /* 逐 token 局部窗口（±140 字符，覆盖多行注释里的信号词），而不是整条注释跳过：
     一条注释里可能既有反例又有真实调用，整条跳过会漏报真失实。 */
  const negContext = (tk) => {
    const at = text.indexOf(tk);
    if (at < 0) return false;
    return NEG.test(text.slice(Math.max(0, at - 140), at + tk.length + 140));
  };
  const miss = [...toks].filter((tk) => {
    if (negContext(tk)) return false;
    if (tk.startsWith('BF.')) {
      const segs = tk.split('.');
      const root = segs.slice(0, 2).join('.');
      const last = segs[segs.length - 1];
      if (!codeOnly.includes(root)) return true;
      return !new RegExp('\\b' + last.replace(/\$/g, '\\$') + '\\b').test(codeOnly);
    }
    const needle = tk.endsWith('()') ? tk.slice(0, -2) : tk;
    return !new RegExp('\\b' + needle.replace(/\$/g, '\\$') + '\\b').test(codeOnly);
  });
  if (miss.length) hits.push({ line: lineAt(m.index), miss, text: text.replace(/\s+/g, ' ').slice(0, 110) });
}
console.log('注释点名了代码里已不存在的符号：' + hits.length + ' 条（共扫 ' + (src.match(re) || []).length + ' 条注释）');
for (const h of hits) console.log('L' + h.line + '  缺 [' + h.miss.join(', ') + ']  ← ' + h.text);
