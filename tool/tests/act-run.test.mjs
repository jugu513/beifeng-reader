/* act.run 的成败口径：resolve(false) 是「没生效」，不得走成功通道、不得登记撤销。 */
import vm from 'node:vm';
import { readMaster, extract } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const code = 'BF.act = (function () {' + extract(src, 'BF.act = (function () {', 'return { run: run };') + 'return { run: run }; })();';

const spy = { ok: [], fail: [], undo: [] };
const box = {
  BF: {
    jobs: { begin: () => 'j', end: () => { spy.ok.push('job-end'); }, fail: () => { spy.ok.push('job-fail'); } },
    feedback: {
      fail: (label, err) => spy.fail.push(label + ':' + (err && err.message)),
      info: (m) => spy.ok.push(m),
    },
    undo: { push: (r) => spy.undo.push(r.label) },
    err: { report: () => {} },
  },
  console, Object, Error, Promise, String,
};
vm.createContext(box);
vm.runInContext(code, box);
const act = box.BF.act;

act.run('写失败', function () { return Promise.resolve(false); }, { success: '已保存', undo: function () {} });
await new Promise((r) => setTimeout(r, 0));
ok('resolve(false)：不给成功提示', spy.ok.length === 0, JSON.stringify(spy.ok));
ok('resolve(false)：不重复报错（调用方自带回执）', spy.fail.length === 0, JSON.stringify(spy.fail));
ok('resolve(false)：不登记撤销', spy.undo.length === 0, JSON.stringify(spy.undo));

spy.ok.length = 0; spy.fail.length = 0;
act.run('写成功', function () { return Promise.resolve(true); }, { success: '已保存', undo: function () {} });
await new Promise((r) => setTimeout(r, 0));
ok('resolve(true)：成功提示 + 撤销登记', spy.ok.indexOf('已保存') >= 0 && spy.undo.length === 1, JSON.stringify(spy));
ok('resolve(true)：不报失败', spy.fail.length === 0);

spy.ok.length = 0; spy.fail.length = 0; spy.undo.length = 0;
act.run('同步成功', function () { return 1; }, { success: '同步成功', undo: function () {} });
ok('同步返回值：照旧成功', spy.ok.indexOf('同步成功') >= 0 && spy.undo.length === 1);

spy.ok.length = 0; spy.fail.length = 0; spy.undo.length = 0;
act.run('抛错', function () { throw new Error('炸'); }, { success: '不该出现', undo: function () {} });
ok('同步抛错：失败、不登记撤销', spy.fail.length === 1 && spy.undo.length === 0 && spy.ok.length === 0, JSON.stringify(spy));

console.log('\n=== act 成败口径: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
