/* 分类可疑字面量：把长串本身掩掉，只露出周边标识符，判断它是凭据还是公开常量/数据URL。 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TARGET } from './patch.mjs';
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');
const show = n => {
  const raw = lines[n - 1] || '';
  const masked = raw.replace(/[0-9a-fA-F]{24,}|[A-Za-z0-9+/]{40,}={0,2}/g, m => '<' + m.length + '位已掩>');
  console.log('L' + n + ': ' + masked.trim().slice(0, 190));
};
console.log('--- 32 位十六进制串落点 ---');
[3790, 15639].forEach(show);
console.log('--- 长 base64 形态串落点 ---');
show(9763);
console.log('--- 邻近上下文（各 ±3 行，同样掩码）---');
for (const c of [3790, 15639, 9763]) {
  console.log('# 附近 ' + c);
  for (let i = c - 3; i <= c + 3; i++) if (i > 0 && i <= lines.length && i !== c) show(i);
}
