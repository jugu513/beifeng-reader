#!/usr/bin/env node
/* 逐项改动账本 + 单项回退/重放。
   目的：每项优化独立记账（精确 old→new 字符串），owner 回头否决某项时，
   只反向替换那一项，其余改动原样保留——不靠"整包回退"这种粗暴手段。

   用法：
     node tool/ledger.mjs list                       列出所有已记账项及状态
     node tool/ledger.mjs record <id> <标题> <ops.json>   验证改动已在场并记账
     node tool/ledger.mjs rollback <id> [--dry]       回退单项（new→old），--dry 只预演
     node tool/ledger.mjs apply <id> [--dry]          重放单项（old→new），--dry 只预演

   ops.json 格式：[{ "old": "原文", "new": "新文", "count": 1 }]
     count 省略默认 1；old/new 必须各自在母本中恰好命中 count 次，否则中止。
   账本文件：ROOT/北风-本轮改动账本.json（交付物，owner 可见）。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { ROOT, TXT, apply, write, gate } from './patch.mjs';

const LEDGER = path.join(ROOT, '北风-本轮改动账本.json');
const md5 = (s) => crypto.createHash('md5').update(typeof s === 'string' ? s : fs.readFileSync(s)).digest('hex');
const load = () => fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { generated: new Date().toISOString(), items: [] };
const save = (db) => fs.writeFileSync(LEDGER, JSON.stringify(db, null, 2) + '\n');
const hitCount = (src, s) => (s === '' ? 0 : src.split(s).length - 1);
const argv = process.argv.slice(2).filter((a) => a !== '--dry');
const [cmd, id, title, opsFile] = argv;
const dry = process.argv.includes('--dry');

function findItem(db, id) {
  const it = db.items.find((x) => x.id === id);
  if (!it) throw new Error(`账本无此项：${id}`);
  return it;
}
function deploy() {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tool', 'deploy.mjs')], { encoding: 'utf8' });
  return out;
}

try {
  if (cmd === 'setbefore') {
    const db = load();
    const it = findItem(db, id);
    if (!title) throw new Error('用法：ledger.mjs setbefore <id> <md5>');
    it.before_md5 = title;
    save(db);
    console.log(`✓ ${id} before_md5 回填为 ${title.slice(0, 8)}`);
    process.exit(0);
  }

  if (cmd === 'list') {
    const db = load();
    if (!db.items.length) { console.log('账本为空，尚无已记账改动。'); process.exit(0); }
    console.log(`账本：${db.items.length} 项 · 文件 ${LEDGER}\n`);
    for (const it of db.items) {
      console.log(`  [${it.status}] ${it.id}  ${it.title}`);
      console.log(`        记账 ${it.time} · before ${it.before_md5?.slice(0, 8)} → after ${it.after_md5?.slice(0, 8)} · ops ${it.ops.length}`);
    }
    process.exit(0);
  }

  if (cmd === 'record') {
    if (!id || !title || !opsFile) throw new Error('用法：ledger.mjs record <id> <标题> <ops.json>');
    const ops = JSON.parse(fs.readFileSync(path.resolve(opsFile), 'utf8'));
    if (!Array.isArray(ops) || !ops.length) throw new Error('ops.json 必须是非空数组');
    const src = fs.readFileSync(TXT, 'utf8');
    // 验证：new 已在场（改动已应用），old 不在场（没被重复记账）
    for (const [i, op] of ops.entries()) {
      /* 允许删除型（new === ''）与新增型（old === ''）：分别对应「整段移除」与「整段插入」，
         两者都必须是显式写出的空串，不能用 undefined 蒙混（那才是真的缺字段）。 */
      if (typeof op.old !== 'string' || typeof op.new !== 'string') throw new Error(`op#${i} 缺 old/new（必须都是字符串，删除/新增用空串 ''）`);
      if (!op.old && !op.new) throw new Error(`op#${i} old 与 new 同时为空——无意义的改动`);
      const c = op.count ?? 1;
      const nHit = hitCount(src, op.new);
      const oHit = hitCount(src, op.old);
      /* 删除型（new===''）：改动落地后 old 应已不在场、new 是空串不计命中；只验 old 清零。
         新增型（old===''）：new 应在场 c 次；old 是空串不计命中。普通型：两者都验。 */
      if (op.new === '') {
        if (oHit !== 0) throw new Error(`op#${i} 删除型：旧文仍在场 ${oHit} 次——可能重复记账或改动不完整`);
      } else if (op.old === '') {
        if (nHit !== c) throw new Error(`op#${i} 新增型：新文命中 ${nHit} 次，期望 ${c}`);
      } else {
        if (nHit !== c) throw new Error(`op#${i} 新文命中 ${nHit} 次，期望 ${c}——改动可能没落地或重复`);
        if (oHit !== 0) throw new Error(`op#${i} 旧文仍在场 ${oHit} 次——可能重复记账或改动不完整`);
      }
    }
    const db = load();
    if (db.items.some((x) => x.id === id)) throw new Error(`id 已存在：${id}`);
    db.items.push({ id, title, status: 'active', time: new Date().toISOString(), before_md5: null, after_md5: md5(src), ops });
    save(db);
    console.log(`✓ 已记账 ${id}「${title}」· ${ops.length} 个 ops · after ${md5(src).slice(0, 8)}`);
    process.exit(0);
  }

  if (cmd === 'rollback' || cmd === 'apply') {
    const db = load();
    const it = findItem(db, id);
    const backward = cmd === 'rollback';
    const want = backward ? 'active' : 'reverted';
    if (it.status !== want) throw new Error(`${id} 当前 ${it.status}，${cmd} 需要 ${want}`);
    let src = fs.readFileSync(TXT, 'utf8');
    // 反向：find=new replace=old；重放：find=old replace=new
    const ops = it.ops.map((op) => ({
      find: backward ? op.new : op.old,
      replace: backward ? op.old : op.new,
      count: op.count ?? 1,
    }));
    // 先做不落盘的验证
    const probe = apply(src, ops);
    if (dry) {
      console.log(`[dry] ${cmd} ${id} 预演通过 · ${ops.length} ops · 行数 ${src.split('\n').length}→${probe.out.split('\n').length}`);
      process.exit(0);
    }
    write(probe.out);
    const dep = deploy();
    const g = gate();
    if (!g.ok) {
      // 门闸红：自动再反操作恢复，避免把母本留在坏状态
      const revOps = it.ops.map((op) => ({ find: backward ? op.old : op.new, replace: backward ? op.new : op.old, count: op.count ?? 1 }));
      write(apply(fs.readFileSync(TXT, 'utf8'), revOps).out);
      deploy();
      throw new Error(`${cmd} ${id} 后门闸变红，已自动还原。门闸输出：\n${g.out.slice(-800)}`);
    }
    it.status = backward ? 'reverted' : 'active';
    it[backward ? 'reverted_at' : 'reapplied_at'] = new Date().toISOString();
    save(db);
    console.log(`✓ 已${backward ? '回退' : '重放'} ${id}「${it.title}」· 门闸仍 19/19`);
    console.log(dep.trim().split('\n').slice(0, 2).join('\n'));
    process.exit(0);
  }

  throw new Error(`未知命令：${cmd}`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
