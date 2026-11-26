/* 零依赖测试 harness —— 从母本按标记抽出代码块，在最小假环境里跑纯逻辑断言。
   只测纯逻辑：真机行为（渲染、焦点、存储往返）归浏览器验证，
   这里不假装能替代它。抽出来的块与被测文件逐字节同一段，不复制源码。 */
import fs from 'node:fs';
import vm from 'node:vm';

export function readMaster(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('找不到内联 script：' + file);
  return m[1];
}

export function extract(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark);
  if (a < 0 || b < 0 || b <= a) throw new Error('标记不配对：' + startMark + ' / ' + endMark);
  return src.slice(a + startMark.length, b);
}

/* 在 vm 沙箱里求值一个块；globals 里给什么，块就能看见什么。 */
export function runBlock(src, opts) {
  const code = extract(src, opts.start, opts.end);
  const sandbox = Object.assign({ BF: {}, console, JSON, Math, Object, Array, String, Number, Boolean, Promise, RegExp, Date, Error, AbortController }, opts.globals || {});
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: opts.name || 'block' });
  return sandbox;
}

export function makeTally() {
  const state = { pass: 0, fail: 0, fails: [] };
  const check = (name, cond, detail) => {
    if (cond) { state.pass++; } else { state.fail++; state.fails.push(name + (detail ? ' :: ' + detail : '')); }
  };
  const report = (label) => {
    console.log('=== ' + label + ': ' + state.pass + ' pass / ' + state.fail + ' fail ===');
    state.fails.forEach((f) => console.log('  FAIL ' + f));
    return state.fail === 0;
  };
  return { check, report, state };
}

/* 假环境：中枢 / 撤销栈 / 确认闸 / 权限级别都做成可计数的桩，
   断言「有没有绕过这些口」靠的就是这些计数器。 */
export function fakeEnv(caps) {
  const spy = { invoke: [], askConfirm: 0, actRun: [], undoRun: 0, log: [], noti: [] };
  const granted = { level: 'read' };
  const undoStack = [];
  const BF = {
    log: {
      _all: [],
      info(m) { const e = { lvl: 'info', msg: m, t: Date.now() }; this._all.push(e); spy.log.push(e); },
      warn(m) { const e = { lvl: 'warn', msg: m, t: Date.now() }; this._all.push(e); spy.log.push(e); },
      list() { return this._all.slice(); },
    },
    err: { report: (w, e) => spy.log.push(['err', w + ':' + (e && e.message)]) },
    noti: { info: (m) => spy.noti.push(m), success: (m) => spy.noti.push(m), warn: (m) => spy.noti.push(m) },
    commands: { register: (c) => { (BF._cmds = BF._cmds || []).push(c); } },
    ask: { confirm: () => { spy.askConfirm++; return Promise.resolve(!!BF._answer); } },
    dsl: {
      permLevel: () => granted.level,
      isSecretLSKey: (k) => /apikey|secret|token|cookie|password|mimo/i.test(String(k)),
    },
    store: {
      _ls: { bookmarks: [{ id: 'b1', note: '好句甲' }, { id: 'b2', note: '好句乙' }], 'bf.aiApiKey': '不该被看见' },
      lsGet(k, d) { return this._ls[k] === undefined ? d : this._ls[k]; },
    },
    err: { recent: () => [] },
    hub: {
      describe: () => (caps || []).slice(),
      invoke: (id, args) => {
        const c = (caps || []).find((x) => x.id === id);
        spy.invoke.push(id);
        if (!c) return { ok: false, error: 'no-cap' };
        if (c.throws) throw new Error(c.throws);
        const list = Array.isArray(args) ? args : (args === undefined ? [] : [args]);
        if (typeof c.run === 'function') {
          const r = c.run.apply(null, list);
          /* 与真 hub.invoke 同形：run 返 promise 时整体也是 promise，
             否则测不出「异步动作被当同成」这一类缺陷 */
          return (r && typeof r.then === 'function')
            ? r.then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: (e && e.message) || String(e) }))
            : { ok: true, value: r };
        }
        return { ok: true, value: 'ran:' + id };
      },
    },
    notes: {
      _list: [{ id: 'n1', text: '旧值', tag: '旧标签' }, { id: 'n2', text: '要删的', tag: '' }],
      all() { return this._list; },
      update(id, patch) {
        const n = this._list.find((x) => x.id === String(id));
        if (!n) return false;
        Object.assign(n, patch || {});
        return true;
      },
      remove(id) {
        /* 真的 remove 里有 await 确认、并且自己走 act.run 登记撤销，返回 promise。
           桩跟着做成同形，否则测不出「一条动作两条撤销」这类结构问题 */
        return Promise.resolve().then(function () {
          const i = this._list.findIndex((x) => x && x.id === String(id));
          if (i < 0) return false;
          const cur = this._list[i];
          this._list.splice(i, 1);
          BF.undo.push({ label: '删除便签', undo: () => { this._list.splice(Math.min(i, this._list.length), 0, cur); } });
          return true;
        }.bind(this));
      },
      restore(rec, at) {
        if (!rec || !rec.id) return false;
        if (this._list.some((n) => n && n.id === rec.id)) return false;
        const i = typeof at === 'number' && at >= 0 && at <= this._list.length ? at : 0;
        this._list.splice(i, 0, rec);
        return true;
      },
    },
    undo: {
      push: (rec) => undoStack.push(rec),
      count: () => undoStack.length,
      /* 真跑闭包：撤销栈的语义就是「执行那条 undo」，桩里只标记一下
         会把「假撤销」测成「真撤销」——那条缺陷正是这轮修掉的 */
      undo: () => { const rec = undoStack.pop(); spy.undoRun++; if (rec && typeof rec.undo === 'function') { try { rec.undo(); } catch (e) { spy.undoError = e; } } },
    },
    act: {
      run: (label, fn, opts) => {
        spy.actRun.push({ label, hasUndo: !!(opts && typeof opts.undo === 'function') });
        const pushUndo = () => { if (opts && typeof opts.undo === 'function') BF.undo.push({ label, undo: opts.undo }); };
        let r;
        try { r = fn(); } catch (e) { return; }
        /* 与真 act.run 同形：promise 动作成功落地之后才登记撤销，失败不登记 */
        if (r && typeof r.then === 'function') { r.then(pushUndo, () => {}); return r; }
        pushUndo();
        return r;
      },
    },
    settings: { get: (k) => (BF._settings || {})[k] },
    _undoStack: undoStack,
    _level: granted,
  };
  return { BF, spy };
}
