/* 发布前凭据预检：扫描「将要外发」的文件，判断里面是否真的不含凭据。
   只输出字段名、值长度、形状与归类，永不打印值本身。
   两层判据，硬的优先：
     ① 归档逐字节比对 —— 与 keys.local.txt 里第 5 列（key）相等的串出现即硬阻断，不接受任何解释；
     ② 形状归类 —— 形态相同不代表性质相同（32 位十六进制既可能是密钥也可能是 md5），
        能机器归类的只有：EDGE 公开协议常量、与母本同源的常量、名称形状、人工名单放行的键名、
        标准 base64 字母表、纯十六进制且上下文当摘要叙述的串；其余一律「待判读」并让退出码变红。
   这一轮实测：母本与双生 0 命中（内置密钥确已清零），pre/baseline-v0.4.3.txt 命中 7 家
   —— 它是「内置服务商密钥还在 PROVIDERS 行里」那个年代的存档，外发必须用 strip-keys 的剥离副本。

   用法：node tool/key-audit.mjs [文件…]     缺省 = 母本
         node tool/key-audit.mjs --staged    扫 tool/ + pre/baseline + 根目录母本双生 + 配套文档 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TXT } from './patch.mjs';
const BASELINE = path.join(ROOT, 'pre', 'baseline-v0.4.3.txt');
const DOCS = ['北风-背景与决策档-2026-10-29.md', 'REMAINING.md', 'comment-cleanup-rules.md', '北风_交接文档.md'];

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
/* 位置参数给的是目录时按目录展开：早先直接 readFileSync(目录) 会 EISDIR 崩掉，
   报「工具坏了」而不是「参数写法不对」，很容易被当成凭据检查失败。 */
const expand = (f) => { const p = path.resolve(ROOT, f); return fs.existsSync(p) && fs.statSync(p).isDirectory() ? listUnder(p) : [p]; };
const files = dirArg ? listUnder(path.resolve(ROOT, dirArg.slice(6)))
  : process.argv.includes('--staged') ? stagedList()
  : argv.length ? argv.flatMap(expand) : [TXT];

function listUnder(d) {
  const out = [];
  const walk = (x) => { for (const f of fs.readdirSync(x, { withFileTypes: true })) {
    const p = path.join(x, f.name);
    if (f.isDirectory()) walk(p); else if (/\.(mjs|js|txt|html|md)$/.test(f.name)) out.push(p);
  } };
  walk(d);
  return out;
}

function stagedList() {
  const out = [TXT, TXT.replace(/\.txt$/, '.html'), BASELINE];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.playwright-mcp'].includes(f.name)) continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (/\.(mjs|js|txt|md)$/.test(f.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'tool'));
  for (const d of DOCS) { const p = path.join(ROOT, d); if (fs.existsSync(p)) out.push(p); }
  return out;
}

const LINE_AT = (src, i) => src.slice(0, i).split('\n').length;

/* 值就地涂掉：定界符内的长串换成 <密:N位>，此后任何上下文输出都不可能带出值。 */
function mask(src) {
  return src.replace(/(['"`])([^'"`\n]{6,})\1/g, (all, d, body) =>
    /^[A-Za-z0-9+/=_-]{6,}$/.test(body) ? d + '<密:' + body.length + '位>' + d : all);
}

/* 母本里的 EDGE 公开协议常量：红线要求逐字节保留，属结构性常量而非用户凭据。
   比对在内存里完成，取值只用于相等判断。 */
const masterRaw = fs.readFileSync(TXT, 'utf8');
const PROTOCOL_CONSTS = new Set(
  [...masterRaw.matchAll(/(?:token|appid|appkey|secret)\s*[:=]\s*['"]([0-9a-fA-F]{32})['"]/gi)].map((m) => m[1])
);

const PATS = [
  ['32位十六进制串', /['"`]([0-9a-fA-F]{32})['"`]/g],
  ['sk-形态密钥', /['"`](sk-[A-Za-z0-9]{8,})['"`]/g],
  ['Bearer硬编码', /Bearer\s+([A-Za-z0-9._-]{12,})/g],
  ['长base64串', /['"`]?([A-Za-z0-9+/]{40,}={0,2})['"`]?/g],
];

/* 两条可机器判定的放行归类（都建立在「母本已证明不含凭据」之上）：
   · 母本同源：整串在母本里逐字节出现（EDGE 的 token / wss path 这类公开协议常量，红线要求原样保留）。
   · 名称清单：斜杠分隔的每段都是母本里存在的标识符（设置键名列表），不是不透明令牌。 */
/* 名称形态：小写词段 + 分隔符（- _ .），数字只许当尾号（v2）。
   上一版把「全小写即可当名称」放得太松：'abc123def456ghi' 这种低熵令牌照样通过，
   真凭据里小写字母加数字的组合很常见，所以数字出现的位置才是可用的判据。 */
const isName = (v) => /^[a-z]+(?:[-_.][a-z]+)*(?:[-_.]v?\d{1,3})?$/.test(v);

/* 归档精确比对（最硬的一道）：形状启发式会漏，逐字节相等不会。
   keys.local.txt 每行按「服务商id · 名称 · base · 默认模型 · key」制表符分隔 —— 只有第 5 列是凭据。
   早期版本把 rec（模型名）也当候选，母本里当然到处都是模型名，一片假警报。
   只报「哪家、几处」，绝不报值。 */
const ARCHIVE = path.join(ROOT, 'keys.local.txt');
const archiveTokens = [];
if (fs.existsSync(ARCHIVE)) {
  for (const line of fs.readFileSync(ARCHIVE, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 5) continue;
    const id = (cols[0] || '').trim(), key = (cols[4] || '').trim();
    if (key.length >= 8) archiveTokens.push({ id: id || '?', tok: key });
  }
}

/* 人工放行名单：形状判据的例外，只登记「字段名」，不登记值。
   豁免条件两条同时成立：名字在名单里 + 值不含数字且 ≤32 位（存储键名普遍是无数字的词典词）。
   归档逐字节比对不受名单影响。 */
const ALLOW_FILE = path.join(ROOT, 'tool', 'cred-allowlist.txt');
const allow = { any: new Set(), byFile: new Map() };
if (fs.existsSync(ALLOW_FILE)) {
  for (const line of fs.readFileSync(ALLOW_FILE, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('::');
    if (i < 0) allow.any.add(t.toLowerCase());
    else { const f = t.slice(0, i).trim(), n = t.slice(i + 2).trim().toLowerCase(); if (!allow.byFile.has(f)) allow.byFile.set(f, new Set()); allow.byFile.get(f).add(n); }
  }
}
const allowlisted = (file, name, value) => {
  if (/[0-9]/.test(value) || value.length > 32) return false;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/').toLowerCase();
  const n = name.toLowerCase();
  if (allow.any.has(n)) return true;
  for (const [f, set] of allow.byFile) if (rel.endsWith(f.toLowerCase()) && set.has(n)) return true;
  return false;
};

/* 形状描述：够判读用，但不含值本身。 */
const shape = (v) => '长' + v.length + ' 小写' + (/[a-z]/.test(v) ? '√' : '×') + ' 大写' + (/[A-Z]/.test(v) ? '√' : '×') +
  ' 数字' + (/[0-9]/.test(v) ? '√' : '×') + ' 符号' + (/[^A-Za-z0-9]/.test(v) ? '√' : '×') +
  ' 十六进制' + (/^[0-9a-fA-F]+$/.test(v) ? '√' : '×');

function classify(value, ctxLine, isSelf) {
  if (PROTOCOL_CONSTS.has(value)) return 'EDGE公开常量';
  /* 扫母本自己时「母本同源」恒真，等于没判 —— 母本这一路只认协议常量白名单与形状 */
  if (!isSelf && masterRaw.includes(value)) return '与母本同源常量';
  if (isName(value)) return '名称形态';
  /* 本应用自己的存储键：以 bf_ 前缀开头（母本里就在用），值是键名不是令牌。 */
  if (/^bf_[a-z0-9_-]+$/.test(value) && masterRaw.includes("'" + value + "'")) return '存储键名';
  /* base64 字母表：定长 64 且正好是标准字母表本身 */
  if (value === 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') return '编码表常量';
  const segs = value.split('/');
  if (segs.length > 1 && /^[A-Za-z][A-Za-z0-9_]*$/.test(segs[0]) && (isSelf || segs.every((s) => masterRaw.includes(s)))) return '名称清单';
  /* 摘要放行门槛：纯小写十六进制且长度 32/40/64（md5/sha1/sha256 的形状），
     且同一行确实把它当摘要或 AIGC 合规标注叙述 —— 高熵密钥不会恰好全是小写十六进制还带这种上下文。 */
  if (/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value)
    && /md5|摘要|digest|指纹|baseline|锚|AIGC|ContentProducer|ProduceID|PropagateID|sha/i.test(ctxLine)) return '摘要';
  return null;
}

/* 就近归属：从命中点往回最多 6 行找最近的赋值名，只报名字。 */
function ownerOf(raw, idx) {
  const lines = raw.slice(0, idx).split('\n');
  for (let k = lines.length - 1; k >= Math.max(0, lines.length - 6); k--) {
    const m = lines[k].match(/([A-Za-z_$][\w$.]*)\s*[:=(]/);
    if (m) return m[1];
  }
  return '无近邻赋值名';
}

let todo = 0, badFields = 0, badArchive = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('跳过（不存在）：' + path.relative(ROOT, f)); continue; }
  if (path.resolve(f) === path.resolve(ARCHIVE)) { console.log('跳过：keys.local.txt 是凭据归档本体，只用来比对，本身绝不进包'); continue; }
  const raw = fs.readFileSync(f, 'utf8');
  const masked = mask(raw);
  const hits = [];
  const maskedLines = masked.split('\n');
  /* 母本与它的打包副本（同名双生）都算「自己」：拿母本当参照系去扫母本的副本，
     等于任何值都能归成「与母本同源」，检查直接失效。 */
  const isSelf = [path.resolve(TXT), path.resolve(TXT.replace(/\.txt$/, '.html'))].includes(path.resolve(f))
    || path.basename(f) === path.basename(TXT) || path.basename(f) === path.basename(TXT).replace(/\.txt$/, '.html');
  for (const [name, re] of PATS) {
    /* 值只在内存里比对，取行号用原文，上下文一律读涂掉后的那一行。 */
    for (const m of raw.matchAll(re)) {
      const line = LINE_AT(raw, m.index);
      const ctx = maskedLines[line - 1] || '';
      const cls = classify(m[1], ctx, isSelf);
      if (!cls) {
        todo++;
        hits.push(name + ' L' + line + ' 【待判读】形状=' + shape(m[1]) + '\n        ' + ctx.trim().slice(0, 110));
      } else hits.push(name + ' L' + line + ' [' + ownerOf(masked, m.index) + '] → ' + cls);
    }
  }
  /* 凭据形态字段：字段名以 Key/Token/Secret/Pwd 结尾且值非空。
     判定与形态扫描共用 classify()：名称形态（存储键名）、母本同源、协议常量都放行，其余一律要人看。 */
  /* 值必须是无空白的连续串：真凭据不含空格。跨字符串字面量拼接（`'?Tok=' + token + '&'`）
     会被放宽的正则误判成凭据，这里用 [^\s'"`] 卡掉整类。 */
  const fields = [...raw.matchAll(/([A-Za-z_$][\w.]*(?:Key|Token|Secret|Pwd|Password))\s*[:=]\s*['"]([^\s'"`]{6,})['"]/gi)];
  const risky = fields.filter((m) => !allowlisted(f, m[1], m[2])
    && !classify(m[2], maskedLines[LINE_AT(raw, m.index) - 1] || '', isSelf));
  /* 归档逐字节比对：命中即硬阻断，不接受任何形状解释 */
  const leaked = archiveTokens.filter((a) => raw.includes(a.tok));
  if (leaked.length) {
    badArchive += leaked.length;
    console.log(path.relative(ROOT, f));
    console.log('  ✗ 含归档凭据原文 ' + leaked.length + ' 处（服务商：' + [...new Set(leaked.map((x) => x.id))].join(', ') + '）—— 该文件绝不能外发');
  }
  if (hits.length || fields.length) {
    console.log(path.relative(ROOT, f));
    if (hits.length) console.log('  形态命中 ' + hits.length + '：\n    ' + hits.join('\n    '));
    console.log('  凭据字段非空 ' + fields.length + ' 个：' +
      (fields.map((m) => m[1] + '(' + m[2].length + '位)').join(', ') || '无') +
      (risky.length ? '  ← 需人工判读 ' + risky.length + ' 个：' +
        risky.map((m) => m[1] + ' ' + shape(m[2])).join(' | ') : ''));
    badFields += risky.length;
  }
}
console.log('\n扫描 ' + files.length + ' 个文件 · 归档比对候选凭据 ' + archiveTokens.length + ' 条（来自 keys.local.txt，只比不打印）' +
  (archiveTokens.length ? '' : '\n  ⚠ 读不到 keys.local.txt：最硬的一层（逐字节比对）本次不生效，只剩形状判据与人工名单 —— 单独跑预检时这不算通过') +
  '\n待判读形态命中 ' + todo + ' · 可疑凭据字段 ' + badFields + ' · 归档命中 ' + badArchive);
if (todo || badFields || badArchive || !archiveTokens.length) {
  console.log('结论：不出包 —— ' + (badArchive ? '归档命中=确有明文凭据在文件里，必须先脱敏；' : '') +
    (todo || badFields ? '其余每一项都要人工判读后放行。' : '') +
    (!archiveTokens.length ? '归档词典 keys.local.txt 不在手边，逐字节那一层没跑 —— 预检未覆盖，不算通过。' : ''));
  process.exit(1);
}
console.log('结论：无凭据外泄风险（EDGE 公开协议常量按红线逐字节保留，摘要与结构名不算凭据，归档比对零命中）。');
