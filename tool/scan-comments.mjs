#!/usr/bin/env node
/* 注释痕迹扫描器 —— 只读，一个字节都不写回目标文件。

   用法：
     node scan-comments.mjs                     扫母本，按类别出圈选清单
     node scan-comments.mjs --all               每类不截断
     node scan-comments.mjs --ctx               每条带下一行代码（认函数名用）
     node scan-comments.mjs --cat 1,3           只看某几类
     node scan-comments.mjs --conf high         只看高置信
     node scan-comments.mjs --range 8000-8300   只扫这段（补丁自查用）
     node scan-comments.mjs --json              机器可读
     node scan-comments.mjs --out tmp/x.md      同一份内容写文件，供圈选
     node scan-comments.mjs --check             只出 §5 十三项计数表，非 0 则退出码 1

   类别号与 outsource/PACKAGE/01-writing-discipline.txt §5 的自检表逐条对齐：
   1 工单/流程编号 · 2 过程叙事词 · 3 协作叙事 · 4 装饰符号 · 5 空洞强调词 ·
   10 外部工件引用。6–9 是代码本体的判据，11 空 catch / 12 裸计时器 / 13 密钥字面量
   不是注释，本器只在计数表里给出（13 永不打印命中内容，只给行号）。
   另加本器专有的启发：21 疑似复述 · 22 多行块 · 24 版本号考古 · 25 墓碑 ·
   26 行号引用 · 27 助手腔语气词。

   ⚓ 两类锚：
     ⚓文案    这条注释里的中文正好是 gate.mjs 的字面量判据 ⇒ 改了闸门变红
     ⚓邻承重  紧接注释下方的代码行被 gate.mjs 计数 ⇒ 删注释安全，别顺手改下面

   本器只报「像痕迹」，不判「该不该删」：带「原先」的句子既可能是废话
   （原先漏了，现已补上），也可能是最有价值的约束说明（原先 7 枚一排要 260px，
   卡只有 171px 可用宽）——两种命中同一条正则，所以清单要人圈，落刀要人判。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TARGET } from './patch.mjs';

const HERE = path.resolve(path.dirname(path.resolve(process.argv[1])), '..');  // scripts live in tool/
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const FILE = has('--file') ? path.resolve(HERE, val('--file', '')) : TARGET;
if (has('--help')) {
  /* 用法就写在文件头的注释里，不再维护第二份 */
  const self = fs.readFileSync(path.resolve(process.argv[1]), 'utf8');
  console.log(self.match(/\/\*[\s\S]*?\*\//)[0]);
  process.exit(0);
}

const src = fs.readFileSync(FILE, 'utf8');
/* 自证抬头：非 json 模式下打印实际读取文件与 md5，避免位置参数失效导致的假绿/假红。
   --json 是机器通道，抬头会破坏解析，故跳过。 */
if (!has('--json')) {
  console.log('[输入] ' + path.relative(HERE, FILE) + ' · md5 ' + crypto.createHash('md5').update(src).digest('hex') + ' · ' + (src.split('\n').length - 1) + ' 行');
}
const lines = src.split('\n');
const lineStarts = [0];
for (let i = 0; i < lines.length; i++) lineStarts.push(lineStarts[i] + lines[i].length + 1);
const lineOf = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };

/* ---------- 区域切分：与 gate ①② 同一组正则 ----------
   手写模式机不可靠（本文件四块 <style>、一块内联 <script>，块之间还有 HTML 注释），
   直接复用闸门的 span 提取，保证「本器看到的字节」与「闸门计数的字节」是同一份。 */
const spans = [];
for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) spans.push({ kind: 'css', from: m.index + m[0].indexOf('>') + 1, body: m[1] });
for (const m of src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/src\s*=/i.test(m[1])) continue;
  spans.push({ kind: 'js', from: m.index + m[0].indexOf('>') + 1, body: m[2] });
}
const spanOffset = new Set();
for (const s of spans) for (let i = s.from; i < s.from + s.body.length; i++) spanOffset.add(i);

/* ---------- 区域内注释提取：认字符串 / 模板 / 正则字面量 ----------
   不认就会把字符串里的定界符（比如内联 HTML 片段里的一段星斜杠）
   和正则里的双斜杠当注释收进来。 */
function commentsIn(body, base, kind) {
  const out = [];
  let i = 0, prevSig = '';
  const push = (start, end) => { if (end > start) out.push({ line: lineOf(base + start), end: lineOf(base + end - 1), text: body.slice(start, end), kind }); };
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; } i++; prevSig = 'x'; continue; }
    if (c === '`') { i++; while (i < body.length && body[i] !== '`') { if (body[i] === '\\') i++; i++; } i++; prevSig = 'x'; continue; }
    if (c === '/' && body[i + 1] === '/') { let e = body.indexOf('\n', i); if (e < 0) e = body.length; push(i, e); i = e; continue; }
    if (c === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); const stop = e < 0 ? body.length : e + 2; push(i, stop); i = stop; continue; }
    /* 正则字面量只在 js 区判：`)`/`]`/标识符之后是除法，其余是正则起始 */
    if (kind === 'js' && c === '/' && (prevSig === '' || /[=(,:[{;&|!?+\-*%<>]$/.test(prevSig))) {
      const save = i; i++; let cls = false, ok = false;
      while (i < body.length) {
        const d = body[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; i++; break; }
        i++;
      }
      if (ok) { while (i < body.length && /[a-z]/.test(body[i])) i++; prevSig = 're'; continue; }
      i = save;
    }
    if (/[A-Za-z0-9_$.]/.test(c)) { let j = i; while (j < body.length && /[A-Za-z0-9_$.]/.test(body[j])) j++; prevSig = body.slice(i, j); i = j; continue; }
    if (/\s/.test(c)) { i++; continue; }
    prevSig = c; i++;
  }
  return out;
}

let found = [];
for (const s of spans) found = found.concat(commentsIn(s.body, s.from, s.kind));
for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
  if (spanOffset.has(m.index)) continue;
  found.push({ line: lineOf(m.index), end: lineOf(m.index + m[0].length - 1), text: m[0], kind: 'html' });
}
found.sort((a, b) => a.line - b.line);

/* ---------- 分类 ---------- */
const CURRENT_VERSION = (src.match(/V\d+\.\d+\.\d+[-\w.]*/) || [''])[0];   /* 产品版本号不该算考古 */
const CONSTRAINT = /(必须|不可|不要|不能|禁止|否则|因为|由于|以免|以防|上限|下限|唯一|同一|只|需要|要求|只能|不得|不应|约定|优先)/;
const WEAK_NARRATIVE = /(之前|此前|原先|原本)/;
const STRONG_NARRATIVE = /(本轮|本次|现已|已改|已修|修复了|交回|外派|并回|漏了|补上|现统一|当年|旧版|上一版)/;
const OBJECTIVE = /(\d|px|em|ch|%|:\d|字号|行高|视口|宽度|高度|溢出|基线|阈值|上限|下限|字节|KB|MB)/;

const CATS = {
  /* 工单号里的 `#NN` 与十六进制色值 `#333` / `#808080` 同形：
     先排除「恰好 3 位或 6 位十六进制且后面不再是十六进制」这种合法色值写法，
     否则全文几十处颜色会被当成流程编号报出来。 */
  '1': ['工单/流程编号', 'high', /(?:^|[^\w])(?:U\d+|P\d+|T\d+-\d|V-\d+|R\d\.\d|S\d\.\d|B\d+-\d|#(?!(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F]))[0-9]{2,5}(?![0-9a-fA-F])|§\d|F-\d+|H\d+-|批次\s*\d|票\s*[A-G](?=[\s、，。）\)])|批注\s*[（(]|BF-\d|BF-修复|审查[一二三四])/],
  '2': ['过程叙事词', 'mid', /(之前|此前|原先|原本|旧版|上一版|本轮|本次|现已|已改|已修|修复了|为了避免|交回|回执|外派|并回|漏了|补上|现统一|曾有)/],
  '3': ['协作叙事', 'high', /(owner|Owner|我们|本项目|本工具|作为AI|助手|模型建议|团队|Buddy)/],
  '4': ['装饰符号', 'high', /[✅❌⚠🚨🚀✨～]/],
  '5': ['空洞强调词', 'high', /(轻松|极致|无缝|一键|智能加持|强大|优雅|赋能|打造)/],
  '10': ['外部工件引用', 'high', /(beifeng\/|outsource\/|upload\/|pre\/|work\/|tmp\/|\.mjs\b|\.py\b|tools\/|gate\.mjs|REMAINING\.md|fix-plan\.md|writing-discipline)/],
  '21': ['疑似复述（只说是什么）', 'mid', null],
  '22': ['多行块（≥6 行，叙事风险）', 'low', null],
  '24': ['版本号考古', 'high', null],
  '25': ['墓碑（指向已不存在的东西）', 'high', /(已删除|已移除|已退役|已下线|删除记录|不再存在|formerly)/],
  '26': ['行号引用（会漂移）', 'high', /\d{4,5}\s*(行|→|处)/],
  '27': ['助手腔语气词', 'high', /(哦|啦|呢|吧|亲|一起来|别担心)/],
};
const CODE_ITEMS = { '6': ['并行态类', /\.active\b|is-on\b|is-open\b/], '7': ['样式压制', /!important/], '8': ['通配命中组件', /\[class\*=/], '9': ['魔法尺寸字面量', /max-height:\s*260px|max-width:\s*340px/], '11': ['空 catch', /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/g], '12': ['裸计时器', /set(?:Timeout|Interval)\(/g], '13': ['密钥字面量', /(?:key|token|secret|authorization|cookie)\s*[:=]\s*['"][A-Za-z0-9_\-.]{28,}['"]/gi] };

function stripDelims(t) {
  return t.replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\*+/, '').replace(/\*+\/$/, '').replace(/^\/\//, '').replace(/^[ \t*]+/gm, '').trim();
}
function versionArc(body) {
  const ms = body.match(/(?:^|[^\w.])[vV]\d+\.\d+(?:\.\d+)?/g) || [];
  return ms.some(m => !CURRENT_VERSION || !m.includes(CURRENT_VERSION.slice(1)));
}
function classify(item) {
  const text = item.text;
  const body = stripDelims(text);
  const hits = [];
  /* 墓碑判据只看「去引用」后的正文：注释里讨论界面文案必然带「已删除书签」这类词，
     那是在分析措辞而不是「某功能已删除」的考古。引号内不参与 25 类匹配。 */
  const deQuoted = body.replace(/「[^」]*」/g, ' ').replace(/[“"][^”"]*[”"]/g, ' ');
  for (const [k, [name, conf, re]] of Object.entries(CATS)) {
    if (!re) continue;
    /* 命中片段全部收：一条注释里常同时有 `票D` 与 `V-40` 两处，
       只报第一个就看不出「为什么命中」。需要 g 标志才拿得到后续匹配，
       所以每次新建 RegExp，绝不复用带 g 的原对象（lastIndex 会串到下一次匹配）。 */
    const target = k === '25' ? deQuoted : body;
    const all = [...target.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]
      .map(x => String(x[0] || '').replace(/^\W{1,2}(?=[\w§#])/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const uniq = [...new Set(all)].slice(0, 3);
    if (uniq.length) hits.push({ k, name, conf, why: uniq.join(' / ') });
  }
  /* 「票D V-09」里的 V-09 归 1 类；只有产品版本号时撤掉这条命中。
     findIndex 可能是 -1（这条注释靠别的候选项进的 1 类），不能直接 splice(-1) —— 那会删掉最后一项 */
  if (hits.some(h => h.k === '1') && CURRENT_VERSION && body.includes(CURRENT_VERSION) && !/(票\s|组\s|U\d|P\d|T\d-|R\d\.|S\d\.|B\d-|F-\d|H\d-|#\d{2,}|§\d)/.test(body)) {
    const at = hits.findIndex(h => h.k === '1');
    if (at >= 0) hits.splice(at, 1);
  }
  if (versionArc(body)) hits.push({ k: '24', name: CATS['24'][0], conf: 'high', why: (body.match(/(?:^|[^\w.])[vV]\d+\.\d+(?:\.\d+)?/) || [''])[0].trim() });
  /* 「助手」在讲气泡左右布局时是界面词不是自我指涉；「我们」在 `我们能`/`我们可以`
     这类句子里也是泛指。两类都不报，免得清单里混进假项让人怀疑整份表。 */
  const c3 = hits.findIndex(h => h.k === '3');
  if (c3 >= 0 && /^(助手|我们)$/.test(hits[c3].why) && /(右|左|气泡|布局|排版)/.test(body)) hits.splice(c3, 1);
  const n2 = hits.find(h => h.k === '2');
  if (n2 && WEAK_NARRATIVE.test(body) && !STRONG_NARRATIVE.test(body) && OBJECTIVE.test(body)) n2.conf = 'low';
  if (n2 && /基线/.test(body) && !/(实测|回归|验收|口径|冻结|棘轮|闸门|工单|批注)/.test(body) && n2.conf === 'mid') n2.conf = 'low';
  if (text.split('\n').length >= 6) hits.push({ k: '22', name: CATS['22'][0], conf: 'low', why: text.split('\n').length + ' 行' });
  /* 「复述」判据只对代码行的短注释成立。分节横线（`/* ===== 排印 =====`）是导航用的，
     不是复述函数名，报出来只会把清单淹掉 —— 同样地，短注释后面不是代码就不算复述。 */
  const isDivider = /(====|----|────|═)/.test(text);
  const nextIsCode = (() => { const n = (lines[item.end] || '').trim(); return !!n && !n.startsWith('/*') && !n.startsWith('*'); })();
  if (body && body.length <= 16 && text.split('\n').length === 1 && !CONSTRAINT.test(body) && !/[（(「]/.test(body) && !isDivider && nextIsCode) hits.push({ k: '21', name: CATS['21'][0], conf: 'mid' });
  return hits;
}

/* ---------- ⚓ 锚：从 gate.mjs 源码里抽，不手写第二份名单 ---------- */
function gateAnchors() {
  const p = path.join(HERE, 'gate-v2.mjs');
  if (!fs.existsSync(p)) return { text: [], codeRe: [] };
  const g = fs.readFileSync(p, 'utf8');
  const text = new Set(), codeRe = [];
  for (const m of g.matchAll(/\/((?:\\.|[^\/\n\\])+?)\/([gimsuy]*)/g)) {
    try {
      const re = new RegExp(m[1]);
      if (/[一-鿿]/.test(m[1])) text.add(m[1].replace(/\\/g, ''));
      else if (!/\\s\\S|\{\d{3,}\}/.test(m[1]) && m[1].length >= 8) codeRe.push(re);
    } catch (e) { /* 编译不了的判据不参与，宁可少报 */ }
  }
  for (const m of g.matchAll(/['"`]([^'"`\n]{4,80})['"`]/g)) if (/[一-鿿]/.test(m[1])) text.add(m[1]);
  return { text: [...text], codeRe };
}
const ANCHOR = gateAnchors();

/* ---------- 汇总 ---------- */
const range = has('--range') ? String(val('--range', '')).split('-').map(Number) : null;
const rows = [];
for (const c of found) {
  if (range && !(c.line >= range[0] && c.line <= (range[1] || range[0]))) continue;
  const hits = classify(c);
  if (!hits.length) continue;
  const raw = lines.slice(c.line - 1, c.end).join('\n');
  const aText = ANCHOR.text.filter(t => raw.includes(t));
  const nextLine = (lines[c.end] || '').trim();
  rows.push({
    id: 0, line: c.line, end: c.end, kind: c.kind, text: c.text,
    cats: hits.map(h => h.k), conf: hits.some(h => h.conf === 'high') ? 'high' : (hits.some(h => h.conf === 'mid') ? 'mid' : 'low'),
    anchorText: aText.length ? aText.slice(0, 2) : null,
    anchorNext: !!nextLine && ANCHOR.codeRe.some(re => re.test(nextLine)),
    why: hits.reduce((o, h) => { o[h.k] = h.why || ''; return o; }, {}),
    ctx: nextLine.slice(0, 78)
  });
}
rows.sort((a, b) => a.line - b.line);
rows.forEach((r, i) => r.id = i + 1);

/* ---------- §5 十三项计数表 ---------- */
const scopeText = range ? lines.slice(range[0] - 1, range[1] || range[0]).join('\n') : src;
const CC = {};
for (const [k, [name, re]] of Object.entries(CODE_ITEMS)) CC[k] = (scopeText.match(re) || []).length;
/* 13 只给行号：命中内容可能就是凭据本身，本器任何模式都不打印它 */
const baseLine = range ? range[0] : 1;
const secLines = [];
{ const re = new RegExp(CODE_ITEMS['13'][1].source, 'gi'); let m;
  while ((m = re.exec(scopeText))) secLines.push(baseLine + (scopeText.slice(0, m.index).match(/\n/g) || []).length); }
CC['13'] = secLines.length;
for (const k of ['1', '2', '3', '4', '5', '10']) CC[k] = rows.filter(r => r.cats.includes(k)).length;
const EXTRA = ['21', '22', '24', '25', '26', '27'];
EXTRA.forEach(k => CC[k] = rows.filter(r => r.cats.includes(k)).length);

const ITEM_NAME = { 1: '工单/流程编号', 2: '过程叙事词', 3: '协作叙事', 4: '装饰符号', 5: '空洞强调词', 6: '并行态类', 7: '样式压制', 8: '通配命中组件', 9: '魔法尺寸字面量', 10: '外部工件引用', 11: '空 catch', 12: '裸计时器', 13: '密钥字面量', 21: '疑似复述', 22: '多行块', 24: '版本号考古', 25: '墓碑', 26: '行号引用', 27: '助手腔语气词' };
const COMMENT_SIDE = ['1', '2', '3', '4', '5', '10'];
function summary() {
  const t = [`§5 十三项计数（${range ? '范围 ' + range[0] + '-' + (range[1] || range[0]) : '全文'}）`];
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'].forEach(k => {
    t.push(`  ${k.padEnd(2)} ${ITEM_NAME[k].padEnd(14)} ${String(CC[k]).padStart(5)}  ${COMMENT_SIDE.includes(k) ? '← 注释类，明细见下' : (k === '13' ? '← 只报数量，不打印内容' : '← 代码本体')}`);
  });
  t.push('  ── 本器专有启发 ──');
  EXTRA.forEach(k => t.push(`  ${k} ${ITEM_NAME[k].padEnd(14)} ${String(CC[k]).padStart(5)}`));
  if (secLines.length) t.push(`  13 命中行号（只给行号，不打印内容）：${secLines.join(', ')}`);
  return t.join('\n');
}

if (has('--check')) {
  console.log(summary());
  const bad = COMMENT_SIDE.concat(EXTRA).filter(k => CC[k] > 0);
  process.exit(bad.length ? 1 : 0);
}

const wantCat = has('--cat') ? String(val('--cat', '')).split(',').map(s => s.trim()).filter(Boolean) : null;
const wantConf = has('--conf') ? val('--conf', '') : null;
const RANK = { high: 3, mid: 2, low: 1 };
const shown = rows.filter(r => (!wantCat || r.cats.some(c => wantCat.includes(c))) && (!wantConf || RANK[r.conf] >= RANK[wantConf]));

if (has('--json')) {
  console.log(JSON.stringify({ file: FILE, lines: lines.length, comments: found.length, hits: rows.length, shown: shown.length, items: CC, rows: shown }, null, 1));
  process.exit(0);
}

const L = [];
L.push(`注释痕迹扫描 · ${path.relative(HERE, FILE)} · ${lines.length} 行`);
L.push(`抽出注释 ${found.length} 条 · 命中 ${rows.length} 条` + (range ? `（范围 ${range[0]}-${range[1] || range[0]}）` : '') + `；每类默认列 15 条，--all 全列，--conf high 只看高置信`);
L.push('');
L.push(summary());
L.push('');
const byCat = new Map();
for (const r of shown) for (const k of r.cats) { if (!byCat.has(k)) byCat.set(k, []); if (!byCat.get(k).some(x => x.id === r.id)) byCat.get(k).push(r); }
for (const k of [...byCat.keys()].sort((a, b) => Number(a) - Number(b))) {
  const list = byCat.get(k).sort((a, b) => a.line - b.line);
  L.push(`── ${k} ${ITEM_NAME[k] || k} · ${list.length} 条`);
  const cap = has('--all') ? list.length : Math.min(list.length, 15);
  for (let n = 0; n < cap; n++) {
    const r = list[n];
    const flags = (r.anchorText ? ` ⚓文案[${r.anchorText.join('/').slice(0, 30)}]` : '') + (r.anchorNext ? ' ⚓邻承重' : '');
    L.push(`  #${String(r.id).padStart(3)} L${r.line}${r.end !== r.line ? '-' + r.end : ''} ${r.kind} [${r.cats.join(',')}] ${r.conf}${flags}${r.why[k] ? ' 命中「' + r.why[k] + '」' : ''}`);
    L.push(`       ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (has('--ctx') && r.ctx) L.push(`       ↳ ${r.ctx}`);
  }
  if (list.length > cap) L.push(`  …还有 ${list.length - cap} 条，加 --all 全列`);
  L.push('');
}
L.push('圈选：把要删的 #号报给我（例：删 #12 #41-#45），按 Edit-only 分段改并复跑闸门。');
L.push('⚓文案 是 gate.mjs 的字面量判据，请跳过；⚓邻承重 表示下方紧邻代码被闸门计数，删注释可以但别动那行。');
const outText = L.join('\n');
if (has('--out')) { const p = path.resolve(HERE, val('--out', 'tmp/comment-scan.md')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, outText); console.log('写出：' + p + `\n（stdout 同内容前 40 行）\n` + outText.split('\n').slice(0, 40).join('\n')); }
else console.log(outText);
