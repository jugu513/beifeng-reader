#!/usr/bin/env node
/* 安装包构建 —— 调 makensis 产出 Windows Setup.exe（每用户安装，免管理员）。
   用法：node dev/tool/pack-installer.mjs        （在仓库根或 dev/ 下运行均可）

   做什么：
     ⓪ 校验 installer.nsi 是 UTF-8 带 BOM（否则中文文件名在 makensis 下乱码）；
     ① 核对仓库根发布文件齐全、成品指纹与 pack.mjs 同源；
     ② makensis 构建到 ASCII 临时名（中文输出名在 -D 传参下有编码风险，构建后改名）；
     ③ 7z 列包验尸：安装器里必须有那 7 个发布文件，缺一个就报错。
   产出：dist/北风V0.0.1-alpha-Setup.exe */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from './patch.mjs';

const PUB = path.dirname(ROOT);
const NSI = path.join(ROOT, 'tool', 'installer.nsi');
const ICON = path.join(PUB, '北风.ico');
const OUT_DIR = path.join(PUB, 'dist');
const TMP_OUT = path.join(OUT_DIR, '_setup-tmp.exe');
const OUT = path.join(OUT_DIR, '北风V0.0.1-alpha-Setup.exe');
const PKG_FILES = [
  '北风V0.0.1-alpha.html', '启动北风.bat', '安装环境.bat', '校验文件.bat',
  '创建桌面快捷方式.bat', 'README.md', 'LICENSE', '北风.ico',
];
const EXPECT_MD5 = '85deffde31e84b31c00fbc0a54a7f94b';

/* ⓪ BOM 校验：NSIS 只认带 BOM 的 UTF-8 脚本里的中文字面量 */
const head = fs.readFileSync(NSI).subarray(0, 3);
if (!(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf)) {
  console.error('✗ installer.nsi 不是 UTF-8 带 BOM，中文会乱码（用 pack-installer.mjs 修回）');
  process.exit(1);
}
console.log('  ✓ installer.nsi UTF-8 BOM');

/* ① 发布文件齐全 + 成品指纹（与 pack.mjs 同一 EXPECT，改成品要两处同步） */
const missing = PKG_FILES.filter((f) => !fs.existsSync(path.join(PUB, f)));
if (missing.length) { console.error('✗ 缺发布文件：' + missing.join('、')); process.exit(1); }
if (!fs.existsSync(ICON)) { console.error('✗ 缺图标：北风.ico（先跑 python3 dev/tool/make-icon.py）'); process.exit(1); }
const h = crypto.createHash('md5').update(fs.readFileSync(path.join(PUB, PKG_FILES[0]))).digest('hex');
if (h !== EXPECT_MD5) { console.error('✗ 成品指纹不符，拒绝构建：' + h); process.exit(1); }
console.log('  ✓ 发布文件齐 · 成品指纹 ' + h);

/* ② 构建 */
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(TMP_OUT, { force: true });
const r = spawnSync('makensis', [
  '-V2',
  `-DSRC_ROOT=${PUB}`,
  `-DOUT_FILE=${TMP_OUT}`,
  NSI,
], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('✗ makensis 失败：\n' + String(r.stdout || '') + String(r.stderr || ''));
  process.exit(1);
}
fs.rmSync(OUT, { force: true });
fs.renameSync(TMP_OUT, OUT);
console.log('  ✓ ' + path.relative(PUB, OUT) + ' · ' + (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB');

/* ③ 验尸：NSIS 安装器本身是 7z 容器，列得出内容才算装得上 */
const l = spawnSync('7z', ['l', '-ba', OUT], { encoding: 'utf8' });
if (l.status !== 0) { console.error('✗ 读取安装器失败'); process.exit(1); }
const listing = String(l.stdout || '');
const absent = [...PKG_FILES, 'Uninstall.exe', '北风.ico'].filter((f) => !listing.includes(f));
if (absent.length) { console.error('✗ 安装器里缺：' + absent.join('、')); process.exit(1); }
console.log('  ✓ 安装器内容核对通过（' + (PKG_FILES.length + 2) + ' 项）');
console.log('✓ 安装包构建完成：' + path.relative(PUB, OUT));
