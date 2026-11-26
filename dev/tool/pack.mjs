#!/usr/bin/env node
/* 绿色版打包 —— 产出给普通用户的免安装 zip（Windows/macOS/Linux 通用，双击 bat 仅 Windows）。
   用法：node dev/tool/pack.mjs        （在仓库根运行；或 cd dev 后 node tool/pack.mjs）

   打什么：只有用户要的东西——成品单文件 + 三个 bat + README + LICENSE。
   不打：dev/（源码与工具）、screenshots/（README 里引用，网页看仓库即可）、index.html（Pages 入口）。
   打之前先验成品指纹，指纹对不上说明成品没同步，打出去的是坏包。
   产出：dist/北风V0.0.1-alpha-win.zip，内部套一层同名文件夹，解压不散文件。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from './patch.mjs';

const PUB = path.dirname(ROOT);   /* 仓库根：面向使用者的发布成品与 bat 都在这里 */
const PKG = '北风V0.0.1-alpha';
const OUT_DIR = path.join(PUB, 'dist');
const OUT = path.join(OUT_DIR, PKG + '-win.zip');
const FILES = [
  PKG + '.html',
  '启动北风.bat',
  '安装环境.bat',
  '校验文件.bat',
  'README.md',
  'LICENSE',
];
/* 官方指纹：与 README、校验文件.bat 保持一致；改成品必须三处同步（selfcheck 八份闸门会盯成品）。 */
const EXPECT_MD5 = '3bb0502f5280f4aefe2b7f74f8022a6a';

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/* ⓪ 成品指纹 */
const main = path.join(PUB, FILES[0]);
if (!fs.existsSync(main)) { console.error('✗ 缺成品：' + FILES[0]); process.exit(1); }
const h = md5(main);
if (h !== EXPECT_MD5) {
  console.error('✗ 成品指纹不符，拒绝打包');
  console.error('  期望 ' + EXPECT_MD5 + '\n  实际 ' + h);
  process.exit(1);
}
console.log('  ✓ 成品指纹 ' + h);

/* ① 清点：缺任何一个都不打，避免打出残缺包 */
const missing = FILES.filter((f) => !fs.existsSync(path.join(PUB, f)));
if (missing.length) { console.error('✗ 缺文件：' + missing.join('、')); process.exit(1); }
console.log('  ✓ 用户文件齐：' + FILES.length + ' 项');

/* ② 打包：先暂存进 dist/<PKG>/ 再压，zip 内套 PKG/ 一层，解压不散文件；-X 不带扩展属性，-q 不刷屏 */
fs.mkdirSync(OUT_DIR, { recursive: true });
const stage = path.join(OUT_DIR, PKG);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(PUB, f), path.join(stage, f));
fs.rmSync(OUT, { force: true });
const r = spawnSync('zip', ['-Xr9q', OUT, PKG], { cwd: OUT_DIR, encoding: 'utf8' });
fs.rmSync(stage, { recursive: true, force: true });
if (r.status !== 0) { console.error('✗ zip 失败：' + (r.stderr || r.stdout)); process.exit(1); }
const size = fs.statSync(OUT).size;
console.log('  ✓ ' + path.relative(PUB, OUT) + ' · ' + (size / 1048576).toFixed(1) + ' MB');

/* ③ 包内清单自检：zip -T 校验完整性，再列一遍条目确认套了文件夹层 */
const t = spawnSync('unzip', ['-tqq', OUT], { encoding: 'utf8' });
if (t.status !== 0) { console.error('✗ 包完整性自检失败'); process.exit(1); }
const l = spawnSync('unzip', ['-Z1', OUT], { encoding: 'utf8' });
const entries = String(l.stdout || '').trim().split('\n').filter(Boolean);
const rootOk = entries.every((e) => e.startsWith(PKG + '/'));
console.log('  ✓ 包内 ' + entries.length + ' 个条目' + (rootOk ? '' : '（警告：有条目在套夹外'));
if (!rootOk) process.exit(1);
console.log('✓ 绿色版打包完成：' + path.relative(PUB, OUT));
