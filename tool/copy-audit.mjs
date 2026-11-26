/* 可见文案痕迹审计：只看会显示给用户看的字符串（noti/confirm/label/title/placeholder/按钮文本），
   找里面的流程编号、协作叙事、版本考古、助手腔。只报行号与命中词，不改动文件。 */
import fs from 'node:fs';
import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/* 界面可见文案的常见落点：这些 API 的参数、HTML 属性、以及拼接进 innerHTML 的中文串 */
const VISUAL = /(BF\.noti\.(?:info|warn|success|error)|BF\.ask\.(?:confirm|alert)|BF\.modal\.(?:confirm|alert)|label\s*:|title\s*[:=]|placeholder\s*=|aria-label\s*=|textContent\s*=|innerHTML\s*=|<p>|<h[1-6] |btn[- ]|\.msg\b)/;
/* 痕迹形态 */
const TRACE = {
  '工单/票号': /票[A-Z]?[\s/-]|[Vv]-\d{2}\b|T\d{1,2}\b|批次\s*\d|§\s*\d|#\d{2,4}\b/,
  '流程词': /本轮|上一轮|这一轮|本次修复|已修复|待验收|交回件|验收口径|工单/,
  '协作叙事': /owner|Owner|用户拍板|已拍板|由我|我们|对方|代理|子代理|work Buddy|AI 写/,
  '版本考古': /v0\.\d+\.\d+|V0\.\d+|旧版|历史兼容|以前叫|曾经/,
  '助手腔': /已为你|为你准备|帮你|下面是|你可以|请知悉|温馨提示|希望能帮/,
  'QA 过程词': /实测|复验|冒烟|回归一遍|待复核|未测/,
};
const hits = {};
for (const [name, re] of Object.entries(TRACE)) hits[name] = [];
lines.forEach((l, i) => {
  if (!VISUAL.test(l)) return;
  const stripped = l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/[\u4e00-\u9fa5]/.test(stripped)) return;
  for (const [name, re] of Object.entries(TRACE)) {
    if (re.test(stripped)) hits[name].push({ line: i + 1, text: stripped.trim().slice(0, 120) });
  }
});
let total = 0;
for (const [name, arr] of Object.entries(hits)) {
  total += arr.length;
  console.log('— ' + name + '：' + arr.length + ' 条');
  arr.slice(0, 10).forEach(h => console.log('   L' + h.line + '  ' + h.text));
}
console.log('合计 ' + total + ' 条候选（需人判：部分是功能术语而非痕迹）');
