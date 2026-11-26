#!/usr/bin/env node
/* 方案B守护闸门：验证 src/ 能字节级还原出当前交付母本。
   做法：build.mjs 构建到临时文件 → 与六份母本逐一比对 md5 → 全一致才过。
   意义：src 与产物不许漂移。任何人改了 src 下的 CSS/模板，构建产物必须仍等于交付单文件；
         若要合法改变产物，须显式走"改根txt→deploy→再从产物重拆src"的流程（见 README）。
   本闸门独立于 gate-v2 的 19 道判据，不扰动现有全绿体系。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const tmp = path.join(os.tmpdir(), 'bf-build-check-' + process.pid + '.html');
const build = spawnSync(process.execPath, [path.join(HERE, 'build.mjs'), tmp], { cwd: ROOT, encoding: 'utf8' });
if (build.status !== 0) {
  console.error('构建失败：' + (build.stderr || build.stdout));
  process.exit(1);
}

const builtHash = md5(tmp);
const copies = [
  '北风V0.0.1-alpha.txt',
  '北风V0.0.1-alpha.html',
  'work/北风V0.0.1-alpha.txt',
  'work/北风V0.0.1-alpha.html',
  'pre/target/北风V0.0.1-alpha.txt',
  'pre/target/北风V0.0.1-alpha.html',
].map((f) => path.join(ROOT, f));

let bad = 0;
console.log('构建产物 md5：' + builtHash);
for (const f of copies) {
  const h = md5(f);
  const ok = h === builtHash;
  if (!ok) bad++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + path.relative(ROOT, f) + ' · ' + h.slice(0, 12));
}
try { fs.unlinkSync(tmp); } catch {}

if (bad > 0) {
  console.error(`\n✗ 构建一致性失败：${bad} 份母本与 src 构建产物不符——src 已漂移，请重新同步`);
  process.exit(1);
}
console.log('\n✓ 构建一致性通过：src 字节级还原出全部 6 份母本（' + builtHash.slice(0, 12) + '）');
