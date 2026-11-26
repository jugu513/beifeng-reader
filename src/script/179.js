/* === BF.agent START === */
BF.agent = (function () {
  'use strict';

  var LEVELS = ['read', 'data', 'full', 'secrets'];

  /* cap → 域。认不出的 cap 一律归 read（宁拒勿放），与中枢的判定同序。 */
  function capDomain(cap) {
    if (!cap) return 'read';
    if (cap.indexOf('secrets:') === 0) return 'secrets';
    if (cap === 'cmd:danger' || cap === 'settings:raw' || cap === 'net') return 'full';
    if (cap === 'store:write' || cap === 'settings:write' || cap === 'cmd:write') return 'data';
    return 'read';
  }

  /* 本次运行的票据：默认只开只读观察面。生命周期 = 一次运行，revert 即失效。 */
  var _granted = { read: true, data: false, full: false, secrets: false };
  var _asked = {};
  var _aborted = false;
  var _liveCtrl = null;
  var _journal = [];
  /* 追加式日志有界。满了就停手并说明原因，不静默丢掉最早的记录。 */
  var JOURNAL_MAX = 500;

  /* 逆操作登记表：没有逆操作的写动作进不了代理——「代理说做完了」必须
     等价于「人批过、且能撤销」，登记一个空 undo 只是把假成功写进撤销栈。
     撤销优先走语义逆（改回去、删回去）；语义逆在撤之前先重读记录：
     字段已不是这次写入造成的样子，说明中间有人动过，此时拒绝并报告，绝不覆盖。 */
  function noteById(id) {
    var list = (BF.notes && BF.notes.all) ? BF.notes.all() : [];
    for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    return null;
  }
  /* 写前取旧值（args 是位置参数数组，与登记表 args 声明同序） */
  var _snapshots = {
    'notes.update': function (args) {
      var n = noteById(args && args[0]);
      if (!n) return null;
      var patch = (args && args[1]) || {};
      var old = {};
      Object.keys(patch).forEach(function (k) { old[k] = n[k]; });
      return { id: String(args[0]), old: old };
    }
  };
  var _inverses = {
    'notes.update': function (args, snap) {
      var patch = (args && args[1]) || {};
      var keys = Object.keys(patch);
      return function () {
        var cur = noteById(snap.id);
        if (!cur) { BF.log.warn('代理撤销被拒：便签 ' + snap.id + ' 已不存在'); return false; }
        for (var i = 0; i < keys.length; i++) {
          if (JSON.stringify(cur[keys[i]]) !== JSON.stringify(patch[keys[i]])) {
            BF.log.warn('代理撤销被拒：便签 ' + snap.id + ' 的 ' + keys[i] + ' 已被别处改动，不硬写回');
            return false;
          }
        }
        BF.notes.update(snap.id, snap.old);
        return true;
      };
    }
  };

  function level() { return (BF.dsl && BF.dsl.permLevel) ? BF.dsl.permLevel() : 'read'; }

  /* 开票：申请的是「域」不是「级」。人按确认走 BF.ask 那一条闸，
     同一域一次运行内被拒之后不再重复问（重复问是提示风暴）。 */
  function requestScope(domain, reason) {
    if (!(domain in _granted)) return Promise.resolve({ ok: false, reason: 'unknown-domain', domain: domain });
    if (_granted[domain]) return Promise.resolve({ ok: true, domain: domain, granted: true });
    var lvNow = level();
    /* 同一域一次任务里被拒之后不再重复问（防提示风暴）；但级别变了就不算同一次前提，
       用户先把权限提到 data 再来要，是新的判断，不该被上一次拒绝钉死。 */
    if (_asked[domain] && _asked[domain] === lvNow) {
      return Promise.resolve({ ok: false, reason: 'already-denied', domain: domain });
    }
    _asked[domain] = lvNow;
    var lv = lvNow;
    if (LEVELS.indexOf(lv) < LEVELS.indexOf(domain)) {
      return Promise.resolve({ ok: false, reason: 'level-not-covered', domain: domain, level: lv });
    }
    var danger = (domain === 'read' || domain === 'data') ? 1 : domain === 'full' ? 2 : 3;
    var ask = (BF.ask && BF.ask.confirm) ? BF.ask.confirm({
      title: '代理请求开票',
      body: '允许本次运行使用 <b>' + domain + '</b> 域的能力。' +
        (reason ? '<br/>理由：' + String(reason) : '') +
        '<br/>当前权限级别：' + lv + '。开票不提升级别，运行结束即失效。',
      confirmText: '开票', danger: danger, op: 'agent.scope',
      /* 票据必须逐次由人按：force 让它不吃「不再询问」的记忆档。
         data 提权那条既有路径就是靠 force 做到这一点的，票据不能比它松。 */
      force: true
    }) : Promise.resolve(false);
    return Promise.resolve(ask).then(function (yes) {
      _granted[domain] = !!yes;
      if (!yes) BF.log.info('代理票据被拒：' + domain);
      return { ok: !!yes, domain: domain, granted: !!yes };
    });
  }
  function revoke(domain) { if (domain in _granted) _granted[domain] = false; return _granted; }

  /* 能力投影：字段全部读登记表已有项，不手写第二份工具清单。 */
  function projectTools() {
    var caps = (BF.hub && BF.hub.describe) ? BF.hub.describe() : [];
    var groups = {};
    var tools = caps.map(function (c) {
      var dom = capDomain(c.cap);
      (groups[dom] = groups[dom] || []).push(c.id);
      return { id: c.id, label: c.label, cap: c.cap, domain: dom, allowed: !!c.allowed, granted: !!_granted[dom] };
    });
    var projected = tools.filter(function (t) { return _granted[t.domain]; });
    return { total: tools.length, projected: projected.length, groups: groups, tools: projected };
  }

  function searchTools(q) {
    var all = (BF.hub && BF.hub.describe) ? BF.hub.describe() : [];
    var s = String(q || '').toLowerCase();
    if (!s) return all.map(function (c) { return c.id; });
    return all.filter(function (c) {
      return (c.id + ' ' + (c.label || '') + ' ' + (c.cap || '')).toLowerCase().indexOf(s) >= 0;
    }).map(function (c) { return c.id; });
  }

  /* 引用不存在的工具名时给同族候选，而不是只回一句「不知道」。 */
  function nearIds(all, toolId) {
    var stem = String(toolId || '').split('.')[0];
    return all.filter(function (c) { return c.id.indexOf(stem + '.') === 0; }).map(function (c) { return c.id; }).slice(0, 6);
  }

  /* 协议 B：只有被 <<<bf / >>> 夹住的 JSONL 才算指令。
     正文里同形的文字不算——书文是不可信输入，一段引述里出现一行 JSON
     不该因此变成动作。解析不过不猜、不静默降级，报错原文回喂一次。 */
  function parseProtocolB(text) {
    var lines = String(text || '').split(/\r?\n/);
    var calls = [];
    var inBlock = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!inBlock) { if (line === '<<<bf') inBlock = true; continue; }
      if (line === '>>>') { inBlock = false; continue; }
      if (!line) continue;
      var obj = null;
      try { obj = JSON.parse(line); } catch (e) {
        return { error: '第 ' + (i + 1) + ' 行不是合法 JSON：' + ((e && e.message) || String(e)), calls: calls };
      }
      if (!obj || typeof obj.do !== 'string') {
        return { error: '第 ' + (i + 1) + ' 行缺 do 字段', calls: calls };
      }
      calls.push(obj);
    }
    /* 块开了没关 = 输出被截断，整块不执行：半个动作比没动作更危险。 */
    if (inBlock) return { error: '围栏未闭合（输出被截断？），本块不执行', calls: [] };
    return { error: null, calls: calls };
  }

  /* 单条动作派发。只读面无副作用，不进撤销栈；写面若无登记逆操作则拒。 */
  function dispatch(toolId, args) {
    var all = (BF.hub && BF.hub.describe) ? BF.hub.describe() : [];
    var cap = null;
    for (var i = 0; i < all.length; i++) { if (all[i].id === toolId) { cap = all[i]; break; } }
    if (!cap) return { ok: false, reason: 'unknown-tool', tool: toolId, hint: nearIds(all, toolId) };
    var dom = capDomain(cap.cap);
    if (!_granted[dom]) return { ok: false, reason: 'ticket-denied', domain: dom, tool: toolId };
    if (_journal.length >= JOURNAL_MAX) return { ok: false, reason: 'journal-full', tool: toolId };
    var selfUndo = !!cap.selfUndo;
    var inverseOf = _inverses[toolId];
    var snap = null;
    if (dom !== 'read' && !selfUndo) {
      if (typeof inverseOf !== 'function') {
        return { ok: false, reason: 'no-inverse', domain: dom, tool: toolId };
      }
      snap = _snapshots[toolId] ? _snapshots[toolId](args) : null;
      if (!snap) return { ok: false, reason: 'no-snapshot', domain: dom, tool: toolId };
    }
    /* selfUndo 的能力自己已经在那条道上登记过撤销（如删便签），代理只调用、不再包一层：
       包了一条动作就有两条撤销，第二次 Ctrl+Z 会把同一条记录再插一遍。 */
    var undo = (dom === 'read' || selfUndo) ? null : inverseOf(args, snap);
    var res;
    /* 动作到底发生没有，看返回值而不是看 promise 有没有落地：
       删除类能力在「人按了取消」与「查无此条」两种情况下返回 false，那什么都没发生，
       既不能记进 journal（diff 里出现一条没发生的行为谎），也不能报 ok。 */
    var isWrite = dom !== 'read';
    function notExecuted(r) { return !r || r.ok === false || (isWrite && r.value === false); }
    function settle(r) {
      var ok = !notExecuted(r);
      if (ok) _journal.push({ tool: toolId, domain: dom, label: cap.label, undoable: !isWrite ? false : (selfUndo || !!undo) });
      return { ok: ok, tool: toolId, domain: dom, result: r, reason: ok ? undefined : 'not-executed' };
    }
    function invokeNow() {
      try { return BF.hub.invoke ? BF.hub.invoke(toolId, args || {}) : { ok: false, error: 'no-invoke' }; }
      catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    }
    if (!isWrite || selfUndo) {
      res = invokeNow();
    } else {
      BF.act.run('代理：' + (cap.label || toolId), function () {
        res = invokeNow();
        /* 把结果原样返回给通道：能力是异步的时候，act.run 才能等 promise 落地再登记撤销。
           不 return 的话通道看到的是「同步成功」，撤销会在动作真正完成之前就挂上栈。 */
        return res;
      }, undo ? { undo: undo } : {});
    }
    if (res && typeof res.then === 'function') {
      return Promise.resolve(res).then(settle, function (e) {
        return { ok: false, reason: 'invoke-failed', tool: toolId, error: (e && e.message) || String(e) };
      });
    }
    return settle(res);
  }

  /* 观察面：代理能做多难的任务，取决于它能看见多少，而不是能改多少。
     密钥键在这里就够不着（既查登记表的黑名单，也查一层键名形状），
     样本一律截断——把整本正文灌进模型上下文不是"观察"，是外泄。 */
  var SAMPLE_MAX = 500;
  var SECRETISH = /(apikey|secret|token|cookie|password|pin)$/i;
  function observeStore(key, filter) {
    if (!key) return { ok: false, reason: 'need-key' };
    var secret = false;
    try { secret = !!(BF.dsl && BF.dsl.isSecretLSKey && BF.dsl.isSecretLSKey(key)) || SECRETISH.test(String(key)); } catch (e) { secret = true; }
    if (secret) return { ok: false, reason: 'secret-unreachable', key: key };
    var v = BF.store.lsGet(key, null);
    var text = typeof v === 'string' ? v : JSON.stringify(v == null ? '' : v);
    var out = { ok: true, key: key, kind: Array.isArray(v) ? 'list' : (v && typeof v === 'object' ? 'dict' : typeof v), bytes: text.length };
    if (Array.isArray(v)) {
      out.count = v.length;
      var hits = filter ? v.filter(function (x) { return JSON.stringify(x).indexOf(String(filter)) >= 0; }) : v;
      out.matched = filter ? hits.length : v.length;
      out.sample = JSON.stringify(hits.slice(0, 3)).slice(0, SAMPLE_MAX);
    } else {
      out.sample = String(text).slice(0, SAMPLE_MAX);
    }
    return out;
  }
  function observeLog(o) {
    var list = (BF.log && BF.log.list) ? BF.log.list() : [];
    var lvl = o.level || 'all';
    var since = Number(o.since || 0);
    var limit = Math.min(40, Math.max(1, Number(o.limit) || 20));
    var ok = list.filter(function (l) {
      return (lvl === 'all' || l.lvl === lvl) && (!since || !l.t || l.t >= since);
    });
    return { ok: true, total: ok.length, lines: ok.slice(-limit).map(function (l) { return { level: l.lvl, msg: String(l.msg || l.text || '').slice(0, 200), t: l.t }; }) };
  }
  function observeProbe(selector, props) {
    if (!selector) return { ok: false, reason: 'need-selector' };
    var el = null;
    try { el = document.querySelector(String(selector)); }
    catch (e) { return { ok: false, reason: 'bad-selector', error: (e && e.message) || String(e) }; }
    if (!el) return { ok: false, reason: 'no-match', selector: String(selector) };
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var keys = (Array.isArray(props) && props.length ? props : ['color', 'background-color', 'font-size', 'font-weight', 'display']).slice(0, 12);
    var style = {};
    keys.forEach(function (k) { try { style[k] = cs.getPropertyValue(k); } catch (e) {} });
    return {
      ok: true, selector: String(selector),
      rect: { x: Math.round(r.left || 0), y: Math.round(r.top || 0), w: Math.round(r.width || 0), h: Math.round(r.height || 0) },
      visible: !!((r.width || 0) || (r.height || 0)), style: style
    };
  }
  /* 断言式来自 JSON，不是函数：拿到值、期望值、关系三者齐了才判。
     关系不认识时报错而不是默认通过——判据写错方向比没判更糟。 */
  function observeAssert(c) {
    var rel = c.op || 'eq', got = c.that, want = c.expected;
    var pass;
    if (rel === 'eq') pass = String(got) === String(want);
    else if (rel === 'truthy') pass = !!got;
    else if (rel === 'gt') pass = Number(got) > Number(want);
    else if (rel === 'lt') pass = Number(got) < Number(want);
    else if (rel === 'contains') pass = String(got).indexOf(String(want)) >= 0;
    else return { ok: false, reason: 'unknown-assert-op', op: rel };
    if (!pass) BF.log.warn('代理断言失败：' + (c.msg || (rel + ' ' + JSON.stringify(want))));
    return { ok: pass, assert: pass ? 'pass' : 'fail', relation: rel, got: got, msg: c.msg || '' };
  }
  /* 计时只准测只读能力：写能力拿来跑 N 次会真改数据，那不是基准是压力测试。 */
  function observeBench(c) {
    if (!c.cap) return Promise.resolve({ ok: false, reason: 'need-cap' });
    var all = (BF.hub && BF.hub.describe) ? BF.hub.describe() : [];
    var cap = null;
    for (var i = 0; i < all.length; i++) { if (all[i].id === c.cap) { cap = all[i]; break; } }
    if (!cap) return Promise.resolve({ ok: false, reason: 'unknown-tool', tool: c.cap });
    if (capDomain(cap.cap) !== 'read') return Promise.resolve({ ok: false, reason: 'bench-read-only', domain: capDomain(cap.cap) });
    var n = Math.min(20, Math.max(1, Number(c.times) || 5));
    var t0 = Date.now();
    function once(k) {
      if (k >= n) return Promise.resolve();
      var r;
      try { r = BF.hub.invoke(c.cap, c.args || []); } catch (e) { r = null; }
      return Promise.resolve(r).then(function () { return once(k + 1); }, function () { return once(k + 1); });
    }
    return once(0).then(function () {
      return { ok: true, cap: c.cap, n: n, perCallMs: +((Date.now() - t0) / n).toFixed(2) };
    });
  }

  /* 元工具与动作工具走同一条派发口，模型不能靠 do 的名字绕过门禁。 */
  function runCall(c) {
    switch (c.do) {
      case 'invoke': return dispatch(c.cap || c.tool, c.args);
      case 'request_scope':
        var caps = c.caps || [c.domain];
        if (!Array.isArray(caps)) caps = [caps];
        return caps.reduce(function (p, d) {
          return p.then(function (acc) { return requestScope(d, c.reason).then(function (r) { acc.push(r); return acc; }); });
        }, Promise.resolve([])).then(function (list) {
          return { ok: list.every(function (r) { return r.ok; }), results: list };
        });
      case 'checkpoint': _checkpoint(c.name); return Promise.resolve({ ok: true, checkpoint: c.name || '' });
      case 'diff': return Promise.resolve({ ok: true, journal: diff() });
      case 'revert': return Promise.resolve({ ok: true, revert: revert() });
      case 'abort': return Promise.resolve({ ok: true, abort: abort() });
      case 'search_tools': return Promise.resolve({ ok: true, ids: searchTools(c.q || c.query) });
      case 'list_tools': return Promise.resolve({ ok: true, tools: projectTools() });
      case 'say': return Promise.resolve({ ok: true, said: String(c.text || '') });
      case 'read_store': return Promise.resolve(observeStore(c.key, c.filter));
      case 'read_log': return Promise.resolve(observeLog(c));
      case 'probe': return Promise.resolve(observeProbe(c.selector, c.props));
      case 'assert': return Promise.resolve(observeAssert(c));
      case 'bench': return observeBench(c);
      case 'report':
        BF.log.info('代理上报：' + JSON.stringify(c.evidence || c.data || {}));
        return Promise.resolve({ ok: true, reported: true });
      default: return Promise.resolve({ ok: false, reason: 'unknown-do', do: c.do });
    }
  }

  /* 循环驱动：取模型输出 → 解析协议 B → 逐条派发 → 预算 / 中止。 */
  function loop(goal, opt) {
    opt = opt || {};
    var model = opt.model || defaultModel;
    var budget = opt.budget || { steps: 12, tokens: (BF.CONFIG.AGENT_TOKEN_BUDGET || 20000) };
    var used = { steps: 0, tokens: 0 };
    var from = _journal.length;
    var repaired = false;
    _aborted = false;
    _asked = {};   /* 一次任务一个开票窗口：上一次任务的拒绝不绑住这一次 */
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    _liveCtrl = ctrl;
    var messages = [
      { role: 'system', content: '你是北风阅读器的代理内核。要执行动作时，输出被 <<<bf 与 >>> 夹住的 JSONL 块，' +
        '每行一个对象：{"do":"invoke","cap":"能力id","args":[]}（args 是位置参数数组，与能力声明同序）；' +
        '需要新的域时先 {"do":"request_scope","caps":["data"],"reason":"…"}。' +
        '观察用 {"do":"read_store","key":"…"} / read_log / probe / assert / bench / report，密钥键读不到。' +
        '块外只写给人看的话。' },
      { role: 'user', content: String(goal || '') }
    ];
    function step() {
      if (_aborted) return Promise.resolve({ ok: true, aborted: 'manual', steps: used.steps });
      if (used.steps >= budget.steps) return Promise.resolve({ ok: true, aborted: 'budget-steps', steps: used.steps });
      return Promise.resolve(model(messages, ctrl ? { signal: ctrl.signal } : {})).then(function (out) {
        if (_aborted) return { ok: true, aborted: 'manual', steps: used.steps };
        /* 模型侧失败必须说出来：把残缺结果当成功，比停下来更坏。 */
        if (out && out.error) {
          BF.log.warn('代理模型调用失败：' + out.error);
          return { ok: false, error: String(out.error), steps: used.steps };
        }
        var text = (out && out.text) || '';
        used.steps++;
        used.tokens += Math.ceil(text.length / 2);
        messages.push({ role: 'assistant', content: text });
        var parsed = parseProtocolB(text);
        if (parsed.error) {
          if (!repaired) {
            repaired = true;
            messages.push({ role: 'user', content: '未按结构返回：' + parsed.error + '。请重发合规的 JSONL 块。' });
            return step();
          }
          return { ok: false, error: '模型未按结构返回：' + parsed.error, steps: used.steps };
        }
        if (!parsed.calls.length) return { ok: true, done: true, steps: used.steps, tokens: used.tokens };
        var results = [];
        return parsed.calls.reduce(function (p, c) {
          return p.then(function () { return runCall(c); }).then(function (r) { results.push(r); });
        }, Promise.resolve()).then(function () {
          messages.push({ role: 'user', content: '工具结果：' + JSON.stringify(results) });
          if (used.tokens >= budget.tokens) return { ok: true, aborted: 'budget-tokens', steps: used.steps };
          return step();
        });
      });
    }
    return step().then(function (r) {
      if (_liveCtrl === ctrl) _liveCtrl = null;
      r.journalFrom = from; r.journalTo = _journal.length; r.used = used; return r;
    });
  }

  /* 默认模型：包一层结构化调用。无密钥时明确失败，不静默返回空。 */
  function defaultModel(messages, mopts) {
    if (!(BF.ai && BF.ai.structured)) return Promise.resolve({ error: 'AI 未就绪：在设置 → AI 服务填密钥' });
    if (!(BF.settings && BF.settings.get && BF.settings.get('aiApiKey'))) {
      return Promise.resolve({ error: '缺少 AI 密钥：设置 → AI 服务' });
    }
    return Promise.resolve(BF.ai.structured(messages, {
      type: 'object', properties: { text: { type: 'string' } }, required: ['text']
    }, { desc: '返回给代理内核的文本（含协议 B 块）', signal: mopts && mopts.signal }))
      .then(function (o) { return { text: (o && o.text) || '' }; },
            function (e) { return { error: (e && e.message) || String(e) }; });
  }

  /* 检查点 = 回滚单位（逐动作回滚会把人淹死，需要的语义是「回到这次任务前」）。 */
  function _checkpoint(label) {
    if (_journal.length >= JOURNAL_MAX) return false;
    _journal.push({ checkpoint: String(label || ('step-' + (_journal.length + 1))) });
    return true;
  }

  function diff() {
    return _journal.map(function (op, i) {
      return op.checkpoint
        ? { i: i, checkpoint: op.checkpoint }
        : { i: i, tool: op.tool, domain: op.domain, label: op.label, undoable: !!op.undoable };
    });
  }

  /* 回滚只走 BF.undo 那一条栈：内核自己调闭包会让栈里留下同一条记录，
     之后一次 Ctrl+Z 会把同一个逆操作重放第二遍。 */
  function revert() {
    var want = _journal.filter(function (op) { return op.undoable; }).length;
    var have = (BF.undo && BF.undo.count) ? BF.undo.count() : 0;
    var n = Math.min(want, have);
    for (var i = 0; i < n; i++) {
      try { BF.undo.undo(); } catch (e) { if (BF.err) BF.err.report('agent.revert', e); break; }
    }
    /* 不可撤的动作也算「没撤」：只要任务里发生过动作、又撤不回来，就不能对用户报「干净」。
       只统计 undoable 项会让只读/不可撤写入也显示 clean=true，属于谎报。 */
    var skipped = _journal.length - n;
    _journal = [];
    _asked = {};
    revoke('data'); revoke('full'); revoke('secrets');
    if (skipped > 0) BF.log.warn('代理回滚：' + n + ' 步已撤，' + skipped + ' 步无撤销记录可放（未回滚）');
    return { reverted: n, notReverted: skipped, clean: skipped === 0 };
  }

  function abort() {
    _aborted = true;
    var ctrlRef = _liveCtrl;
    if (ctrlRef) { try { ctrlRef.abort(); } catch (e) {} }
    return { aborted: true, steps: _journal.length };
  }

  function status() {
    return {
      journal: _journal.length, aborted: _aborted,
      granted: Object.keys(_granted).filter(function (k) { return _granted[k]; }),
      level: level()
    };
  }

  /* 命令注册走 BF.commands 单注册表；输出走终端与吐司，不开新面板。 */
  function _reg(id, label, keywords, cat, run) {
    if (BF.commands && BF.commands.register) BF.commands.register({ id: id, label: label, keywords: keywords, cat: cat, run: run });
  }
  _reg('agent.status', '查看代理内核状态（票据 / journal）', 'agent 代理 内核 状态 status', 'AI', function () {
    BF.noti.info('代理：' + JSON.stringify(status()));
  });
  _reg('agent.run', '用假模型跑一次代理循环（离线自测）', 'agent run 代理 自测', 'AI', function () {
    loop('读一下书架和书签', { model: fakeModelForSelfTest(), budget: { steps: 8, tokens: 4000 } }).then(function (r) {
      BF.noti.info('agent.run 自测：' + JSON.stringify({
        steps: r.steps, aborted: r.aborted || null, error: r.error || null,
        journal: r.journalTo - r.journalFrom
      }));
    });
  });
  _reg('agent.diff', '查看代理 journal（diff）', 'agent diff 日志', 'AI', function () { BF.noti.info('agent journal: ' + JSON.stringify(diff())); });
  _reg('agent.revert', '整批回滚代理操作', 'agent revert 回滚 撤销', 'AI', function () {
    var r = revert();
    BF.noti[r.clean ? 'success' : 'warn']('agent revert: 回滚 ' + r.reverted + ' 步' + (r.clean ? '' : '，' + r.notReverted + ' 步未能回滚'));
  });
  _reg('agent.abort', '中止代理循环', 'agent abort 中止', 'AI', function () {
    var r = abort() || {};
    BF.noti.info(r.aborted ? ('代理已中止：共 ' + (r.steps || 0) + ' 步') : '当前没有在跑的代理任务');
  });
  _reg('agent.search', '在能力投影里搜索工具', 'agent search 搜索 工具', 'AI', function () {
    var list = searchTools('') || [];
    BF.noti.info('可用工具 ' + list.length + ' 个：' + list.slice(0, 8).map(function (t) { return t && (t.id || t.name) || ''; }).filter(Boolean).join('、') + (list.length > 8 ? ' 等' : ''));
  });

  /* 假模型（离线自测，不触网、不写密钥）：turn1 两个只读动作 + 一个检查点，
     turn2 一个 data 域动作——默认白名单下应当被拒且不被执行。 */
  function fakeModelForSelfTest() {
    var t = 0;
    return function () {
      t++;
      if (t === 1) return Promise.resolve({ text: '先看两处只读。\n<<<bf\n{"do":"invoke","cap":"nav.home"}\n{"do":"invoke","cap":"read.remain"}\n{"do":"checkpoint","name":"读过书架与剩余时长"}\n>>>\n' });
      if (t === 2) return Promise.resolve({ text: '<<<bf\n{"do":"invoke","cap":"data.export"}\n>>>\n' });
      return Promise.resolve({ text: 'done' });
    };
  }

  return {
    capDomain: capDomain, projectTools: projectTools, searchTools: searchTools,
    parseProtocolB: parseProtocolB, dispatch: dispatch, loop: loop,
    diff: diff, revert: revert, abort: abort, status: status,
    requestScope: requestScope, revoke: revoke, checkpoint: _checkpoint,
    _fakeModelForSelfTest: fakeModelForSelfTest,
    get journal() { return _journal; }, get granted() { return _granted; }
  };
})();
