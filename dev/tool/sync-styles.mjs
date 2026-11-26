#!/usr/bin/env node
/* 从母本重抽 9 个 <style> 块 → src/styles/01–09.css（方案B 的 CSS 同步唯一入口）。
   背景：resplit.mjs 只重拆 script，不重拆 CSS；改母本 CSS 后必须手动同步 src，
   否则 build-check 红且很难定位。本工具把「手工同步」变成一条不会漏的命令。

   三个必须守住的细节（踩过的坑）：
   1. 文件末尾不补换行——模板的 {{STYLE_NN}} 占位符行自带换行，补了会多一个空行；
   2. 第 9 块（body 内的设置样式）在模板里占位符前已有 2 空格缩进，写回时去掉母本的前导空格，
      否则构建产物多 2 空格；
   3. 检测块边界而不是硬编码行号——以后母本增删行也不会失效。 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TXT } from './patch.mjs';

/* P1 后护栏：真源已反转到 src/，本脚本（根 txt → 重抽 CSS 到 src）方向相反，
   日常运行会用构建产物覆盖 src 里的真源改动。必须显式带 --confirm-overwrite-src。
   日常改 CSS 直接编辑 src/styles/NN.css，再跑 build + deploy（或 selfcheck）。 */
if (!process.argv.includes('--confirm-overwrite-src')) {
  console.error('✗ sync-styles.mjs 已降级为迁移工具（真源已是 src/）。');
  console.error('  日常改样式请直接编辑 src/styles/NN.css，再跑 node tool/build.mjs && node tool/deploy.mjs。');
  console.error('  确需从旧母本迁移，才加 --confirm-overwrite-src 显式确认。');
  process.exit(2);
}

const lines = fs.readFileSync(TXT, 'utf8').split('\n');
const starts = [], ends = [];
lines.forEach((line, i) => {
  if (/^\s*<style(?:\s|>)/.test(line)) starts.push(i);
  if (/^\s*<\/style>/.test(line)) ends.push(i);
});
if (starts.length !== 9 || ends.length !== 9) {
  console.error(`样式块数量异常：起始 ${starts.length} / 结束 ${ends.length}（期望各 9）——母本可能被手改`);
  process.exit(1);
}
if (starts.some((s, i) => ends[i] <= s)) {
  console.error('样式块起止配对异常：存在 end <= start');
  process.exit(1);
}
starts.forEach((a, i) => {
  const b = ends[i];
  let body = lines.slice(a, b + 1).join('\n');
  if (i === 8) body = body.replace(/^  /, '');
  const name = String(i + 1).padStart(2, '0') + '.css';
  const dest = path.join(ROOT, 'src', 'styles', name);
  fs.writeFileSync(dest, body);
  console.log(`✓ ${name} ← 母本 L${a + 1}-${b + 1}（${Buffer.byteLength(body)} B）`);
});
console.log('✓ 9 块样式已同步；请跑 node tool/build-check.mjs 验字节一致');
