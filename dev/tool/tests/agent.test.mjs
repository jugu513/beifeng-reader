/* 代理内核回归（A 线 P0 验收口径）—— 加载母本真实 BF.agent 块，假模型驱动，不触网、不写密钥。
   用法：node tool/tests/agent.test.mjs [母本路径] */
import { readMaster, runBlock, fakeEnv, makeTally } from '../harness.mjs';

const MASTER = process.argv[2] || 'work/北风V0.0.1-alpha.txt';
const src = readMaster(MASTER);
const { check, report } = makeTally();

const CAPS = [
  { id: 'nav.home', label: '回首页', cap: 'cmd:navigate', allowed: true },
  { id: 'read.remain', label: '本章剩余', cap: 'cmd:read', allowed: true },
  { id: 'data.export', label: '导出备份', cap: 'cmd:write', allowed: false },
  { id: 'notes.add', label: '加便签', cap: 'store:write', allowed: false },
  { id: 'notes.update', label: '更新便签', cap: 'store:write', allowed: false,
    run: (id, patch) => LIVE.notes.update(id, patch) },
  { id: 'notes.remove', label: '删除便签', cap: 'store:write', selfUndo: true, allowed: false,
    run: (id) => LIVE.notes.remove(id) },
  { id: 'shelf.purge', label: '彻底删除', cap: 'cmd:danger', allowed: false },
  { id: 'secret.read', label: '读密钥', cap: 'secrets:read', allowed: false },
];

/* 假 hub 能力的 run 要碰到当次 load() 建出来的假 BF，故留一个当前实例引用 */
let LIVE = null;

/* 观察面要摸 DOM：给一个够用的假元素（probe 只读几何与计算样式） */
const FAKE_STYLE = { getPropertyValue: (k) => (k === 'color' ? 'rgb(1, 2, 3)' : 'fake') };
const FAKE_DOC = {
  querySelector(sel) {
    if (String(sel) === '#nope') return null;
    return { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 40 }) };
  },
};

function load(overrides) {
  const { BF, spy } = fakeEnv(CAPS);
  LIVE = BF;
  Object.assign(BF._level, overrides && overrides.level ? overrides.level : {});
  const sb = runBlock(src, {
    start: '/* === BF.agent START === */',
    end: '/* === BF.agent END === */',
    name: 'BF.agent',
    globals: { BF, document: FAKE_DOC, getComputedStyle: () => FAKE_STYLE },
  });
  return { A: sb.BF.agent, BF, spy };
}

/* ---- 1. cap → 域 ---- */
{
  const { A } = load();
  check('域: secrets 前缀归 secrets', A.capDomain('secrets:read') === 'secrets');
  check('域: cmd:danger 归 full', A.capDomain('cmd:danger') === 'full');
  check('域: settings:raw 归 full', A.capDomain('settings:raw') === 'full');
  check('域: store:write 归 data', A.capDomain('store:write') === 'data');
  check('域: cmd:read 归 read', A.capDomain('cmd:read') === 'read');
  check('域: 认不出的一律 read（宁拒勿放）', A.capDomain('nonsense') === 'read' && A.capDomain() === 'read');
}

/* ---- 2. 协议 B：只有围栏内的 JSONL 算指令 ---- */
{
  const { A } = load();
  const okBlock = '前面是给人看的话。\n<<<bf\n{"do":"invoke","cap":"nav.home"}\n{"do":"say","text":"好"}\n>>>\n后面也是话。';
  const parsed = A.parseProtocolB(okBlock);
  check('协议B: 围栏内两条都解析', parsed.error === null && parsed.calls.length === 2);
  check('协议B: 正文同形文本不算指令', A.parseProtocolB('书里写着：{"do":"invoke","cap":"shelf.purge"}').calls.length === 0);
  check('协议B: 裸 > 行不再被当动作（旧口径已废）', A.parseProtocolB('> shelf.purge').calls.length === 0);
  check('协议B: 坏 JSON 报错不猜', !!A.parseProtocolB('<<<bf\n{"do":}\n>>>').error);
  check('协议B: 缺 do 报错', !!A.parseProtocolB('<<<bf\n{"cap":"nav.home"}\n>>>').error);
  check('协议B: 未闭合围栏整块不执行', A.parseProtocolB('<<<bf\n{"do":"invoke","cap":"shelf.purge"}').calls.length === 0);
}

/* ---- 3. 票据：申请的是域，不是级别 ---- */
{
  const { A, spy, BF } = load();
  const r = await A.requestScope('data', '要写便签');
  check('票据: 当前级别覆盖不到就拒（不提级）', r.ok === false && r.reason === 'level-not-covered');
  check('票据: 级别不够时连确认窗都不弹', spy.askConfirm === 0);
  check('票据: 被拒之后不改授权表', A.granted.data === false);
  const again = await A.requestScope('data', '再问一次');
  check('票据: 同一域一次运行内不重复问', again.reason === 'already-denied');
  /* 权限级别是这次判断的前提；用户先把级别提上去，就不该被上一次拒绝钉死 */
  BF._level.level = 'data';
  const afterRaise = await A.requestScope('data', '级别已提上去');
  check('票据: 级别变了可以重新问（前提变了不是同一次）', afterRaise.reason !== 'already-denied');
}
{
  const { A, spy, BF } = load({ level: { level: 'data' } });
  BF._answer = false;
  const no = await A.requestScope('data', '要写便签');
  check('票据: 级别覆盖到了要问人', spy.askConfirm === 1 && no.ok === false);
  const { A: A2, spy: spy2, BF: BF2 } = load({ level: { level: 'data' } });
  BF2._answer = true;
  const yes = await A2.requestScope('data', '要写便签');
  check('票据: 人批之后该域放行', yes.ok === true && A2.granted.data === true);
  check('票据: 放行只改票据表，权限级别一字未动', spy2.askConfirm === 1 && BF2._level.level === 'data');
  check('票据: 默认白名单只有 read', A.granted.read === true && A.granted.full === false && A.granted.secrets === false);
  check('内核不导出裸翻转 grant（提权只能问人）', A.grant === undefined && typeof A.requestScope === 'function');
}

/* ---- 4. 派发门禁与写通道 ---- */
{
  const { A, spy } = load();
  const denied = A.dispatch('data.export', {});
  check('门禁: 未开票的写动作不执行', denied.ok === false && denied.reason === 'ticket-denied' && spy.invoke.length === 0);
  const unknown = A.dispatch('nav.nonexistent', {});
  check('门禁: 不存在的工具给同族候选', unknown.reason === 'unknown-tool' && Array.isArray(unknown.hint));
  const readRes = A.dispatch('nav.home', {});
  check('只读: 放行并落 journal', readRes.ok === true && A.journal.length === 1);
  check('只读: 不进撤销栈（无副作用不该占位）', spy.actRun.length === 0 && spy.undoRun === 0);
}
{
  /* 写动作：没有登记逆操作 → 拒绝执行，而不是登记一个空 undo 假装可撤销 */
  const { A, BF, spy } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '要写便签');
  const refused = A.dispatch('notes.add', { a: 1 });
  check('写: 无逆操作时拒绝执行（不产假撤销）', refused.ok === false && refused.reason === 'no-inverse' && spy.invoke.length === 0);
  BF._answer = false;
  const deniedAfter = A.dispatch('data.export', {});
  check('写: 人拒票据后仍不放行', deniedAfter.ok === false);
}
{
  /* journal 有界：满了停手并说明，不静默丢最早记录 */
  const { A, BF } = load();
  for (let i = 0; i < 500; i++) A.journal.push({ tool: 'x', domain: 'read', label: 'x', undoable: false });
  const full = A.dispatch('nav.home', {});
  check('journal 有界：满额拒绝新动作', full.ok === false && full.reason === 'journal-full');
  check('journal 有界：旧记录一条没丢', A.journal.length === 500);
  void BF;
}

/* ---- 4b. 语义撤销与撤销前的前置检查 ---- */
{
  const { A, BF, spy } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '改一条便签');
  const w = A.dispatch('notes.update', ['n1', { text: '新值' }]);
  check('写: 有语义逆的动作真的执行', w.ok === true && spy.invoke.indexOf('notes.update') >= 0);
  check('写: 便签真的被改', BF.notes._list[0].text === '新值');
  check('写: 走 BF.act.run 单通道且带真实 undo', spy.actRun.length === 1 && spy.actRun[0].hasUndo === true);
  check('写: journal 记为可撤', A.journal.length === 1 && A.journal[0].undoable === true);
  check('写: 撤销栈里躺真条目（不是空闭包占位）', BF.undo.count() === 1);
  /* 前置检查：我们写完别人又改过一次，撤销必须拒绝，而不是把人家的改动覆盖掉 */
  BF.notes.update('n1', { text: '第三方改动' });
  BF.undo.undo();
  check('前置检查: 值已不是我们写成那样 → 拒绝写回', BF.notes._list[0].text === '第三方改动');
  check('前置检查: 拒绝时说得出原因', spy.log.some((l) => l.lvl === 'warn' && /已被别处改动/.test(l.msg)));
}
{
  const { A, BF } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '改一条便签');
  A.dispatch('notes.update', ['n1', { text: '新值' }]);
  const r = A.revert();
  check('回滚: 整批撤销只走 BF.undo 一条道且真回到旧值', r.reverted === 1 && BF.notes._list[0].text === '旧值' && r.clean === true);
  check('回滚: 写票随运行结束收回（revert 之后 data 不再放行）', A.granted.data === false);
  await A.requestScope('data', '再试两条边界');
  const nosnap = A.dispatch('notes.update', ['查无此条', { text: 'x' }]);
  check('写: 取不到旧值就不写（no-snapshot）', nosnap.ok === false && nosnap.reason === 'no-snapshot');
  const noinv = A.dispatch('notes.add', ['x']);
  check('写: 无逆操作的动作仍被拒（不产假撤销）', noinv.ok === false && noinv.reason === 'no-inverse');
}

/* ---- 4c. 能力自带撤销的动作：代理只调用，不再挂第二条 ---- */
{
  const { A, BF, spy } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '删一条便签');
  const p = A.dispatch('notes.remove', ['n2']);
  check('删: promise 落地前不记 journal（不把未发生的动作算成做完）', A.journal.length === 0);
  const d = await p;
  check('删: 落地后才报 ok', d.ok === true && A.journal.length === 1);
  check('删: 真的删掉了', BF.notes._list.length === 1 && !BF.notes._list.some((n) => n.id === 'n2'));
  check('自撤: 代理不包 act.run（一条动作只有能力自己那一条撤销）', spy.actRun.length === 0);
  check('自撤: 栈里只有一条目', BF.undo.count() === 1);
  check('自撤: journal 如实标可撤', A.journal[0].undoable === true);
  BF.undo.undo();
  check('自撤: 一次 Ctrl+Z 放回原位原内容', BF.notes._list.length === 2 && BF.notes._list[1].id === 'n2' && BF.notes._list[1].text === '要删的');
  check('自撤: 栈已空，不存在第二次插同一条', BF.undo.count() === 0);
  const gone = await A.dispatch('notes.remove', ['查无此条']);
  check('删: 查不到的记录报 not-executed（不产假成功）', gone.ok === false && gone.reason === 'not-executed');
  check('删: 没发生就不进 diff', A.journal.length === 1);
}
{
  /* 动作没发生（人按取消 / 异步拒绝）：不许记进 diff、不许报成功 */
  const { A, BF } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '测失败路径');
  const n0 = BF.notes._list.length;
  BF.notes.remove = () => Promise.resolve(false);           /* 人按了取消 */
  const cancelled = await A.dispatch('notes.remove', ['n1']);
  check('取消: 不报成功', cancelled.ok === false && cancelled.reason === 'not-executed');
  check('取消: 不进 diff', A.journal.length === 0);
  check('取消: 数据一条没动', BF.notes._list.length === n0);
  BF.notes.remove = () => Promise.reject(new Error('写挂了'));  /* 传输层失败 */
  const bad = await A.dispatch('notes.remove', ['n2']);
  check('异步失败: 报失败并带原因', bad.ok === false && /写挂了/.test(JSON.stringify(bad.result || bad.error || '')));
  check('异步失败: 失败的动作不进 diff', A.journal.length === 0);
}

/* ---- 5. 回滚只走 BF.undo 那一条栈 ---- */
{
  const { A, BF, spy } = load({ level: { level: 'data' } });
  BF._answer = true;
  await A.requestScope('data', '批量写');
  /* 逆操作登记表在内核闭包里，测试只能从行为验证：
     先记两条只读（不可撤），再看 revert 的 notReverted 是否如实报出。 */
  A.dispatch('nav.home', {});
  A.dispatch('read.remain', {});
  const r = A.revert();
  check('回滚: 不可撤的动作如实计入 notReverted', r.reverted === 0 && r.notReverted === 2 && r.clean === false);
  check('回滚: 有不可撤项时不谎报干净', r.clean === false);
  check('回滚: 结束运行即收回写票', A.granted.data === false && A.granted.full === false);
  check('回滚: journal 清零', A.journal.length === 0);
  check('回滚: 内核不自己调撤销闭包（走 BF.undo）', spy.undoRun === 0);
}

/* ---- 6. 循环驱动：预算 / 中止 / 失败要出声 ---- */
{
  const { A, spy } = load();
  const fake = A._fakeModelForSelfTest();
  const r = await A.loop('读一下书架和书签', { model: fake, budget: { steps: 8, tokens: 4000 } });
  check('循环: 假模型跑完并落 journal', r.steps === 3 && r.journalTo - r.journalFrom === 3);
  check('循环: 只读动作真的执行了 2 次', spy.invoke.length === 2);
  check('循环: 检查点入账（回滚单位是检查点）', A.journal.some((o) => o.checkpoint));
  check('循环: 未开票的写动作连 invoke 都没发生', spy.invoke.indexOf('data.export') === -1);
  const dataTried = A.journal.filter((o) => o.tool === 'data.export').length;
  check('循环: 未开票的写动作不进 journal', dataTried === 0);
}
{
  const badModel = () => Promise.resolve({ text: '<<<bf\n{"do":oops}\n>>>' });
  const { A } = load();
  let calls = 0;
  const r = await A.loop('目标', { model: () => { calls++; return badModel(); }, budget: { steps: 6, tokens: 2000 } });
  check('循环: 解析失败回喂一次再停', calls === 2 && r.ok === false && /未按结构返回/.test(r.error || ''));
  check('循环: 失败不静默当成功', r.done !== true);
}
{
  const { A, BF } = load();
  BF._settings = { aiApiKey: '' };
  const r = await A.loop('目标', { budget: { steps: 2, tokens: 500 } });
  check('循环: 无密钥时明确失败并指向设置', r.ok === false && /密钥/.test(r.error || ''));
}
{
  const { A } = load();
  let n = 0;
  const slow = () => Promise.resolve(n++ < 1 ? { text: '<<<bf\n{"do":"invoke","cap":"nav.home"}\n>>>' } : { text: '<<<bf\n{"do":"invoke","cap":"nav.home"}\n>>>' });
  const p = A.loop('目标', { model: slow, budget: { steps: 30, tokens: 99999 } });
  const ab = A.abort();
  const r = await p;
  check('中止: abort 置位并回报步数', ab.aborted === true && typeof ab.steps === 'number');
  check('中止: 循环真的停下（不是只返回个对象）', r.aborted === 'manual');
}
{
  const { A } = load();
  const r = await A.loop('目标', { model: () => Promise.resolve({ text: '<<<bf\n{"do":"invoke","cap":"nav.home"}\n>>>' }), budget: { steps: 2, tokens: 40 } });
  check('预算: 超步数停下并说明', r.aborted === 'budget-steps' || r.aborted === 'budget-tokens');
}

/* ---- 7. 元工具都在派发口里，且不绕过门禁 ---- */
{
  const { A, spy } = load();
  const r = await A.loop('目标', {
    model: () => Promise.resolve({ text: '<<<bf\n{"do":"search_tools","q":"nav"}\n{"do":"list_tools"}\n{"do":"diff"}\n{"do":"report","evidence":{"x":1}}\n{"do":"abort"}\n>>>' }),
    budget: { steps: 3, tokens: 500 },
  });
  void r;
  check('元工具: search/list/diff/report/abort 走同一条派发口', spy.invoke.length === 0);
  check('元工具: abort 元工具生效', A.status().aborted === true);
  const unknown = A.parseProtocolB('<<<bf\n{"do":"fly_to_moon"}\n>>>');
  check('元工具: 不认识的 do 由派发口拒绝', unknown.calls[0].do === 'fly_to_moon');
}

/* ---- 7b. 观察面：能看见多少决定上限，但密钥够不着 ---- */
{
  const { A, BF } = load();
  const calls = [];
  const results = [];
  const model = (msgs) => {
    const tail = String((msgs[msgs.length - 1] || {}).content || '');
    if (tail.indexOf('工具结果：') === 0) { try { results.push(JSON.parse(tail.slice('工具结果：'.length))); } catch (e) {} }
    calls.push(msgs.length);
    if (calls.length === 1) {
      return Promise.resolve({ text: '<<<bf\n' +
        '{"do":"read_store","key":"bookmarks"}\n' +
        '{"do":"read_store","key":"bf.aiApiKey"}\n' +
        '{"do":"probe","selector":"#topbar","props":["color"]}\n' +
        '{"do":"probe","selector":"#nope"}\n' +
        '{"do":"assert","that":3,"op":"gt","expected":2}\n' +
        '{"do":"assert","that":3,"op":"gt","expected":9,"msg":"该失败"}\n' +
        '{"do":"assert","that":1,"op":"sqrt"}\n' +
        '{"do":"bench","cap":"nav.home","times":3}\n' +
        '{"do":"bench","cap":"notes.update"}\n' +
        '{"do":"read_log","level":"warn"}\n>>>\n' });
    }
    return Promise.resolve({ text: 'done' });
  };
  const r = await A.loop('观察一轮', { model, budget: { steps: 4, tokens: 9000 } });
  /* 断言在解析后的结果对象上做，不在转义文本里找引号 */
  const res = results[0] || [];
  const at = (i) => JSON.stringify(res[i] || {});
  check('观察: 一轮观察跑完（十条回执）', res.length === 10);
  check('观察: 只读键能取到形状与样本', /"bytes":/.test(at(0)) && /好句甲/.test(at(0)));
  check('观察: 密钥键够不着', /secret-unreachable/.test(at(1)));
  check('观察: probe 给出几何与计算样式', /rgb\(1, 2, 3\)/.test(at(2)) && /"w":200/.test(at(2)));
  check('观察: 选择器不匹配如实报 no-match', /no-match/.test(at(3)));
  check('观察: 断言按关系判（gt 3>2 通过）', /"assert":"pass"/.test(at(4)));
  check('观察: 断言不成立时如实报 fail', /"assert":"fail"/.test(at(5)));
  check('观察: 不认识的断言关系报错，不默认通过', /unknown-assert-op/.test(at(6)));
  check('观察: bench 测只读能力', /perCallMs/.test(at(7)));
  check('观察: bench 拒绝写能力', /bench-read-only/.test(at(8)));
  check('观察: read_log 取到刚才那条断言失败告警', /代理断言失败/.test(at(9)));
  check('观察: 观察动作不进 journal', A.journal.length === 0 && r.steps === 2);
  check('观察: 回执里没有密钥值', at(1).indexOf('不该被看见') === -1 && JSON.stringify(res).indexOf('不该被看见') === -1);
}

/* ---- 8. 结构红线：不碰面板 / 不注册中枢 ---- */
{
  const { A, BF } = load();
  check('守界: 不往 BF.hub 运行时注册能力', BF.hub.register === undefined);
  check('守界: 无自开面板（动作入口只在终端与命令表）', A.openPanel === undefined);
  check('守界: 命令注册进单表 agent.* 六条', (BF._cmds || []).filter((c) => c.id.indexOf('agent.') === 0).length === 6);
}

process.exit(report('代理内核回归') ? 0 : 1);
