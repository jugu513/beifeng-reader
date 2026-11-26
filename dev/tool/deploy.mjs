#!/usr/bin/env node
/* 发布到测试环境 —— 本包的唯一「同步/替换」入口。
   owner 2026-11-23 定的规矩：工具只读一个文件夹里被测试的程序（pre/target/）；
   程序有更改，就重新替换为最新的一份。这个脚本就是那个「替换」动作。

   设计：编辑真源只有一份 = dev/ 工程根的 北风V0.0.1-alpha.txt。其余七份都是它的派生物，
   由本脚本统一字节级复制并校验 md5：
     dev 根 .html · work/.txt · work/.html · target/.txt · target/.html
     （以上五份为闸门契约副本）+ 仓库根发布成品两份：
     仓库根/北风V0.0.1-alpha.html（用户下载的完整包）· 仓库根/index.html（Pages 入口）
   这样彻底消灭「改了母本忘了 html / work 陈旧 / target 与根不同步 / 发布成品漂移」这类同步事故——
   编辑只动 dev 根 txt，发布只跑 deploy，八份永远一致。selfcheck 开头会自动跑本脚本。

   幂等：内容相同的派生物跳过写入，只报「已一致」；反复跑不改动任何字节。
   用法：node tool/deploy.mjs [--force]   （--force 即使一致也强制重写，通常不需要）
   退出码：全部一致 → 0；同步后仍不一致或读写失败 → 1。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, TXT, HTML, TARGET, TARGET_HTML } from './patch.mjs';

const hash = (b) => crypto.createHash('md5').update(b).digest('hex');
const force = process.argv.includes('--force');
const workTxt = path.join(ROOT, 'work', '北风V0.0.1-alpha.txt');
const workHtml = path.join(ROOT, 'work', '北风V0.0.1-alpha.html');

let bad = false;
try {
  if (!fs.existsSync(TXT)) { console.error('✗ 编辑真源缺失：' + TXT); process.exit(1); }
  const src = fs.readFileSync(TXT);
  const sh = hash(src);
  console.log('  编辑真源 · 北风V0.0.1-alpha.txt · md5 ' + sh + ' · ' + (src.toString('utf8').split('\n').length - 1) + ' 行');

  const PUB = path.dirname(ROOT);   /* 仓库根：面向使用者的发布成品放这里 */
  const deriv = [
    ['北风V0.0.1-alpha.html', HTML],
    ['work/北风V0.0.1-alpha.txt', workTxt],
    ['work/北风V0.0.1-alpha.html', workHtml],
    ['pre/target/北风V0.0.1-alpha.txt', TARGET],
    ['pre/target/北风V0.0.1-alpha.html', TARGET_HTML],
    ['../北风V0.0.1-alpha.html（发布成品）', path.join(PUB, '北风V0.0.1-alpha.html')],
    ['../index.html（Pages 入口）', path.join(PUB, 'index.html')],
  ];
  for (const [label, dst] of deriv) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    let dh = null;
    if (fs.existsSync(dst)) dh = hash(fs.readFileSync(dst));
    if (dh === sh && !force) { console.log('  ✓ ' + label + ' 已一致'); continue; }
    fs.writeFileSync(dst, src);
    const now = hash(fs.readFileSync(dst));
    const ok = now === sh;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + label + ' ' + (dh ? '已更新' : '已写入') + ' · md5 ' + now);
    if (!ok) bad = true;
  }
  console.log(bad ? '✗ 同步后仍有不一致，勿信后续工具结论' : '✓ 七份派生物全部就位（含仓库根发布两份）· 工具唯一输入 pre/target/ 已刷新');
} catch (e) {
  console.error('✗ 同步失败：' + e.message);
  bad = true;
}
process.exit(bad ? 1 : 0);
