import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* 路径唯一真源：编辑母本与双生在工程根目录（beifeng/），闸门 ③ 的密钥参照基线在 pre/。
   历史：曾迁入 work/，2026-11-14 清理后回归根目录，本文件位置推导即可定位。

   2026-11-23 分工（owner 定）：编辑真源在根（TXT/HTML），**测试输入**统一收敛到
   pre/target/（TARGET/TARGET_HTML）——所有只读工具默认审 target 那一份，不再各自
   去读根 / work / 别的层级。改完母本必须 `node tool/deploy.mjs` 同步进 target，
   selfcheck 开头会自动做这一步，保证「工具永远审到最新程序」。
   这样工具只有一个输入目录，杜绝「验到旧代码 / 路径解析到工程外直接崩」两类事故。 */
export const ROOT = path.resolve(import.meta.dirname, '..');   /* 脚本住在 beifeng/tool/ 下，工程根是它的上一级 */
export const TXT = path.join(ROOT, '北风V0.0.1-alpha.txt');
export const HTML = path.join(ROOT, '北风V0.0.1-alpha.html');
export const PRE = path.join(ROOT, 'pre');
export const TARGET_DIR = path.join(PRE, 'target');
export const TARGET = path.join(TARGET_DIR, '北风V0.0.1-alpha.txt');
export const TARGET_HTML = path.join(TARGET_DIR, '北风V0.0.1-alpha.html');
export const GATE = path.join(ROOT, 'tool', 'gate-v2.mjs');

export const read = () => fs.readFileSync(TXT, 'utf8');
export const lineOf = (src, needle) => src.split('\n').findIndex((l) => l.includes(needle)) + 1;

/** 按行区间替换：起止各给一个「文件内唯一」的短锚点，避免把上百字符的块抄进 find 串。
    抄错一个百分号编码就会静默失配，而这类块正是要删的东西。 */
export function cut(src, startNeedle, endNeedle, replace, opts = {}) {
  const lines = src.split('\n');
  const hits = (n) => lines.map((l, i) => (l.includes(n) ? i : -1)).filter((i) => i >= 0);
  const sh = hits(startNeedle), eh = hits(endNeedle);
  if (sh.length !== 1) throw new Error(`起点锚命中 ${sh.length} 次（须恰好 1）：${startNeedle}`);
  const a = sh[0] - (opts.startMinus || 0);
  let b = -1;
  for (const i of eh) if (i >= sh[0]) { b = i; break; }
  if (b < 0) throw new Error(`终点锚在起点之后未命中：${endNeedle}`);
  b += (opts.endPlus || 0);
  const removed = b - a + 1;
  const out = lines.slice(0, a).concat(replace === null ? [] : replace.split('\n'), lines.slice(b + 1)).join('\n');
  console.log(`  cut 删 ${removed} 行 @L${a + 1} → ${replace === null ? '（删除）' : replace.split('\n').length + ' 行'}`);
  return out;
}

/** ops: [{ find, replace, count?, where? }]  —— find 必须唯一命中（默认 1 次），否则整体中止 */
export function apply(src, ops) {
  let out = src;
  const log = [];
  for (const [i, op] of ops.entries()) {
    const { find, replace, count = 1 } = op;
    if (!out.includes(find)) throw new Error(`op#${i} 「${find.slice(0, 70)}」 未找到`);
    const hits = out.split(find).length - 1;
    if (hits !== count) throw new Error(`op#${i} 命中 ${hits} 次，期望 ${count}：${find.slice(0, 70)}`);
    out = out.split(find).join(replace);
    log.push(`op#${i} ok ×${count} @L${lineOf(out, replace.split('\n')[0].trim()) || '?'}`);
  }
  return { out, log };
}

export function write(src) {
  fs.writeFileSync(TXT, src, 'utf8');
  fs.writeFileSync(HTML, src, 'utf8');
}

export function gate() {
  try {
    return { ok: true, out: execFileSync(process.execPath, [GATE], { encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

export function snapshot(tag) {
  fs.mkdirSync(PRE, { recursive: true });
  fs.copyFileSync(TXT, path.join(PRE, `step-${tag}.txt`));
  return path.join(PRE, `step-${tag}.txt`);
}
