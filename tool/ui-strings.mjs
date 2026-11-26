/* 只读：把母本里「用户可能看见的文字」抽出来，按可疑词表打标。
   覆盖：HTML 静态文本与 placeholder/title/aria-label、JS 里的通知/确认/反馈/标签/提示词文案、
   命令表 desc/usage、设置行标题。输出按可疑级别排序，带行号，便于逐条圈选。
   用法：node tool/ui-strings.mjs [母本路径] [--all] */
import fs from 'node:fs';

import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const ALL = process.argv.includes('--all');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/* 助手腔 / 营销腔 / 破折号解释腔 / 过时死引用 / 表情与语气词 */
const RULES = [
  ['助手腔', /(你可以|您可以|请先|请确保|请选择|请注意|您好|亲爱的|让我|我来帮你|帮你|帮您|我们|咱们)/],
  ['营销腔', /(一键|智能|丝滑|极致|强大|无缝|全新|重磅|贴心|优雅|完美|轻松|极大|非常|超级|深度赋能|赋能)/],
  ['语气词', /(啦|呢|哦|喔|呀|嘛|哟|咯|~)/],
  ['感叹', /[！!]{1,}/],
  ['破折号解释腔', /——/],
  ['过时名词', /(纸鸢|护眼模式|沉浸阅读|工作台模式|旧版|下一版|上一版)/],
  ['开发词', /(TODO|FIXME|XXX|临时|先这样|暂不|待补|占位)/],
];

const hits = [];
function add(lineNo, text, kind) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return;
  for (const [name, re] of RULES) {
    if (re.test(t)) { hits.push({ lineNo, name, kind, text: t.slice(0, 110) }); return; }
  }
  if (ALL) hits.push({ lineNo, name: '', kind, text: t.slice(0, 110) });
}

/* 1) HTML 静态文本：只取 body 内（用最后一个 </script> 之后作为近似 body 起点不可靠，
   这里改为整文件扫，但跳过 <script>/<style> 区间） */
let inScript = false, inStyle = false;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (/<script[\s>]/i.test(L)) inScript = true;
  if (/<\/script>/i.test(L)) { inScript = false; continue; }
  if (/<style[\s>]/i.test(L)) inStyle = true;
  if (/<\/style>/i.test(L)) { inStyle = false; continue; }
  if (inScript || inStyle) continue;
  const textOnly = L.replace(/<[^>]*>/g, ' ').trim();
  if (textOnly && /[\u4e00-\u9fa5]/.test(textOnly)) add(i + 1, textOnly, 'HTML文本');
  const attrs = L.match(/(placeholder|title|aria-label|alt)="([^"]*)"/g) || [];
  attrs.forEach(a => { const m = /="([^"]*)"/.exec(a); if (m) add(i + 1, m[1], '属性'); });
}

/* 2) JS 用户可见文案 */
const PATTERNS = [
  [/BF\.noti\.(?:info|warn|error|success|warnOnce|errorOnce)\(\s*'([^']{2,})'/, '通知'],
  [/BF\.feedback\.(?:fail|warn|info|success|error)\(\s*'([^']{2,})'/, '反馈'],
  [/BF\.ask\.(?:confirm|prompt)\(\s*\{[^}]*?title:\s*'([^']{2,})'/, '确认标题'],
  [/BF\.modal\.(?:confirm|alert|prompt)\(\s*'([^']{2,})'/, '模态'],
  [/(?:placeholder|title|aria-label)\s*[:=]\s*'([^']{2,})'/, '属性JS'],
  [/(?:placeholder|title|aria-label)\s*[:=]\s*"([^"]{2,})"/, '属性JS双引'],
  [/desc:\s*'([^']{2,})'/, '命令说明'],
  [/usage:\s*'([^']{2,})'/, '命令用法'],
  [/_row\('([^']{2,})'/, '设置行'],
  [/(?:label|text|msg|hint|tip):\s*'([^']{2,}[\u4e00-\u9fa5][^']*)'/, '文案键'],
  [/\bbody:\s*'([^']{2,}[\u4e00-\u9fa5][^']*)'/, '确认正文'],
  [/\bdetail:\s*'([^']{2,}[\u4e00-\u9fa5][^']*)'/, '错误细节'],
  [/pane-empty">([^<]{2,})</, '空态'],
  [/pane-hint[^>]*>([^<]{4,})</, '提示行'],
  [/>([\u4e00-\u9fa5][^<>{]{3,40})</, '模板文本'],
];

/* 任何含 ≥6 个汉字的单引号字符串也纳入（覆盖拼串里的半句文案） */
const CJK_LONG = /'([^'\n]{0,40}[\u4e00-\u9fa5][^'\n]{5,})'/;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (!/[\u4e00-\u9fa5]/.test(L)) continue;
  for (const [re, kind] of PATTERNS) {
    const m = re.exec(L);
    if (m) add(i + 1, m[1], kind);
  }
  const ml = CJK_LONG.exec(L);
  if (ml && ml[1].length >= 8) add(i + 1, ml[1], '拼串文案');
}

/* 3) 手册/Markdown 里的产品文案（DSL manual 数组） */
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (/^\s*'\s*#{1,4}\s/.test(L) || /^\s*'[-*]\s/.test(L)) {
    if (/[\u4e00-\u9fa5]/.test(L)) add(i + 1, L.replace(/^\s*'/, ''), '手册');
  }
}

const byName = {};
hits.forEach(h => { const k = h.name || '(无标记)'; byName[k] = (byName[k] || 0) + 1; });
console.log(JSON.stringify({ file: FILE, total: hits.length, byName }, null, 2));
const LIMIT = ALL ? 400 : 120;
hits.slice(0, LIMIT).forEach(h => console.log(`${String(h.lineNo).padStart(6)} [${h.name || '-'}] ${h.kind}  ${h.text}`));
if (hits.length > LIMIT) console.log(`… 另有 ${hits.length - LIMIT} 条（--all 全列）`);
