/* 只读：列「用户可见文案」里的可疑项（跳过注释、跳过只进日志的字符串）。
   与 ai-clear 的误报库一致：产品术语与守护串不在此列。 */
import fs from 'node:fs';
import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const L = fs.readFileSync(FILE, 'utf8').split('\n');
const RULES = [
  ['助手腔', /(你可以|您可以|请先|请确保|请选择|请注意|您好|亲爱的|我来帮你|帮你|帮您|我们|咱们)/],
  ['营销腔', /(一键|智能|丝滑|极致|强大|无缝|全新|重磅|贴心|优雅|完美|轻松|超级|深度赋能|赋能)/],
  ['语气词', /(啦|呢|哦|喔|呀|嘛|哟|咯)/],
  ['破折号', /——/],
  ['过时', /(纸鸢|护眼模式|工作台模式|旧版|下一版|上一版)/],
  ['开发', /(TODO|FIXME|XXX|临时|先这样|待补|占位|未注册|疑似泄漏)/],
];
const STR = /'(?:[^'\\]|\\.)*[\u4e00-\u9fa5](?:[^'\\]|\\.)*'/g;
const out = [];
for (let i = 0; i < L.length; i++) {
  const s = L[i];
  if (!/[\u4e00-\u9fa5]/.test(s)) continue;
  if (/^\s*(\/\*|\*|\/\/)/.test(s)) continue;
  if (/BF\.(log|err)\b/.test(s)) continue;
  const ms = s.match(STR);
  if (!ms) continue;
  for (const raw of ms) {
    const txt = raw.slice(1, -1);
    if (txt.length < 4) continue;
    if (/(请先打开一本书|请先选中|请先选择书)/.test(txt)) continue;   /* 产品常规提示，不列 */
    let tag = '';
    for (const [n, re] of RULES) { if (re.test(txt)) { tag = n; break; } }
    if (!tag) continue;
    out.push(String(i + 1).padStart(6) + ' [' + tag + '] ' + txt.slice(0, 88));
  }
}
console.log(out.join('\n'));
console.log('--- total', out.length);
