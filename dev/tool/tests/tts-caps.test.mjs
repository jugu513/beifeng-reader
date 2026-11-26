/* 引擎能力表判据（只读母本，不改产品）。

   这张表要买的保险是「加一档引擎＝在表里加一行」。所以本测试的核心手法是：
   把母本里那张表连同退避阶梯、路由、探针、失败提示一起取出来，
   再用字符串插入往表里加一行 mock，然后在 Node 里跑这些读点。
   哪里还在按引擎名分支，加进去的这一行就不会被认出来——
   「加一行只改一行」这件事从此有了会红的判据（此前只能靠人读代码保证）。
   基线（不插行）也跑一遍：证明这些断言不是恒真。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const START = 'BF.tts.CAPS = {';
const END = '/* ============================================================\n   北风 · tts 域（二）';
const s = src.indexOf(START);
const e = src.indexOf(END, s);
if (s < 0 || e < 0) { console.error('找不到能力表区段（母本结构变了？）'); process.exit(2); }
const region = src.slice(s, e);

/* 往表里加一行：插在 offline 之前 = 阶梯第三档。联网、产字节、有凭据引导。 */
const MOCK_ROW = `  mock: {
    id: 'mock', label: '假引擎', network: true, native: false,
    canUse: function () { return BF.__mock.avail; },
    synth: function (t) { BF.__mock.synth.push(t); return Promise.resolve({ tag: 'blob-mock', t: t }); },
    cacheKeyOf: function () { return 'mock|v1'; },
    voiceName: function () { return '假音色'; },
    guideB: '。根因推测：假引擎的凭据不对。',
    guideBAct: { label: '去设置填假密钥', set: 'mockSecret' },
    timeline: function () { return false; },
    timelineFor: function () { return null; },
  },
`;
/* 第二形态：新加的是「浏览器代管播放」的档——回落终点应由它来当，而不是写死 offline */
const MOCK_NATIVE = `  mocknat: {
    id: 'mocknat', label: '假本机档', network: false, native: true,
    canUse: function () { return BF.__mock.avail; },
    synth: null, cacheKeyOf: null,
    localState: function () { return BF.__mock.avail ? 'ok' : 'down'; },
    playNative: function (segs, pos) { BF.__mock.play.push(segs.length, pos); },
    stopNative: function () { BF.__mock.stop++; },
    pauseNative: function () { BF.__mock.pause++; },
    resumeNative: function () { BF.__mock.resume++; },
    timeline: function () { return false; },
    timelineFor: function () { return null; },
  },
`;
const withRow = (row) => {
  const out = region.replace('  offline: {', row + '  offline: {');
  if (out === region) { console.error('插不进 mock 行（offline 那一行的写法变了？）'); process.exit(2); }
  return out;
};

function build(body) {
  const calls = { notices: [], logs: [], errs: [], opens: [], ctl: [], timers: [], play: [], stop: 0, pause: 0, resume: 0 };
  const settings = {
    ttsEngine: 'auto', ttsAutoOnline: true, ttsAutoOffline: true,
    ttsSentenceBoundary: false, ttsWordHighlight: true, ttsEdgeVoice: 'v1', ttsRate: 1, ttsPitch: 1,
  };
  const flag = { edgeAvail: true, probeOk: false };
  const BF = {
    __mock: { avail: true, play: [], stop: 0, pause: 0, resume: 0, synth: [] },
    settings: {
      get: (k) => (k in settings ? settings[k] : undefined),
      set: (k, v) => { settings[k] = v; },
      num: (k, d) => (typeof settings[k] === 'number' ? settings[k] : d),
    },
    CONFIG: { TTS_STAB: { WATCHDOG_MS: 60000, NOTI_GATE_MS: 30000, COOL_T1_MS: 1500, PROBE_STALE_MS: 0, PROBE_GATE_MS: 60000, TTL: { B: 900000, C: 900000, E: 60000, D: 300000 } } },
    log: { info: (m) => calls.logs.push(m), warn: (m) => calls.logs.push(m), error: (m) => calls.logs.push(m) },
    err: { report: (t) => calls.errs.push(t) },
    noti: {
      warn: (m, o) => calls.notices.push({ level: 'warn', m: m, act: o && o.action }),
      info: (m) => calls.notices.push({ level: 'info', m: m }),
      error: (m) => calls.notices.push({ level: 'error', m: m }),
    },
    timers: { timeout: (fn, ms) => { calls.timers.push([fn, ms]); return function () {}; }, interval: () => function () {} },
    settingsUI: { open: (t) => calls.opens.push(t), _ctl: (k) => { calls.ctl.push(k); return { focus: () => {} }; } },
    bus: { on: () => {} }, EVENTS: { SETTINGS: 'settings' },
    tts: {
      state: { engine: 'offline', playing: false, _stopIntent: false, _sess: 1, segs: null, pos: 0 },
      _setPhase: () => {}, setPlayIcon: () => {}, _pfClear: () => {},
      updateVoiceLabel: () => {}, syncStatusLabel: () => {},
      onlineSpeak: (segs, from, eng) => { calls.logs.push('onlineSpeak:' + eng); },
      edge: {
        canUse: () => flag.edgeAvail,
        synthesize: (t) => Promise.resolve({ tag: 'blob-edge', t: t }),
        probeConnect: () => Promise.resolve({ ok: flag.probeOk, reason: 'stub' }),
        timelineFor: () => null, VOICES: [{ id: 'v1', display: '假晓晓' }],
      },
      mimo: {
        enabled: () => false,
        synthesize: () => Promise.reject(Object.assign(new Error('没配密钥'), { code: 'B' })),
        voiceId: () => 'v', format: () => 'wav', VOICES: [],
      },
      offline: {
        available: () => true,
        speak: (segs, pos) => { calls.play.push(segs.length, pos); },
        stop: () => { calls.stop++; }, pause: () => { calls.pause++; }, resume: () => { calls.resume++; },
        segment: (t) => [t], tryVoice: () => {}, voice: () => null,
      },
    },
  };
  const sandbox = {
    BF, console, Date, Promise, Math, JSON, Object, Array, String, Number, Error, Map, Set, isNaN, parseInt,
    navigator: { onLine: true },
    document: { getElementById: () => null, addEventListener: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  return { BF, calls, settings, flag };
}

/* ---------- 基线：不插行 ---------- */
const base = build(region);
ok('阶梯按表键序派生（edge→mimo→浏览器语音→none）',
  base.BF.tts.LADDER.join(',') === 'edge,mimo,offline,none', base.BF.tts.LADDER.join(','));
ok('档位名表与阶梯同宽', Object.keys(base.BF.tts.ENGINE_LABELS).length === 3);
ok('冷却名单只收联网档', (function () {
  const c = base.BF.tts.stab._snapshot().coolUntil;
  return c.edge === 0 && c.mimo === 0 && c.offline === undefined;
})(), JSON.stringify(base.BF.tts.stab._snapshot().coolUntil));

/* ---------- 插一行联网档 ---------- */
const A = build(withRow(MOCK_ROW));
A.flag.edgeAvail = false;                        /* Edge 不可用 */
A.BF.tts.mimo.enabled = () => false;              /* MiMo 没配密钥 */
ok('加一行就进了阶梯（插在 offline 之前 = 第三档）',
  A.BF.tts.LADDER.join(',') === 'edge,mimo,mock,offline,none', A.BF.tts.LADDER.join(','));
ok('自动档沿阶梯选中新档（旧写法会跳过它直落浏览器语音）',
  A.BF.tts.pickEngine() === 'mock', A.BF.tts.pickEngine());
ok('新档同样受黑表约束：入表即不可用', (function () {
  const one = build(withRow(MOCK_ROW));
  one.BF.tts.stab.blacklist('mock', 'B');
  return one.BF.tts.stab.usable('mock') === false;
})());
ok('黑表只挡这一档：另建一份环境中新档仍可用', A.BF.tts.pickEngine() === 'mock');
A.settings.ttsAutoOnline = false;
ok('「允许联网朗读」关后新档同样被跳过（它也联网）', A.BF.tts.pickEngine() === 'offline', A.BF.tts.pickEngine());
A.settings.ttsAutoOnline = true;
A.settings.ttsEngine = 'mock';
ok('设置里点名下档：没有 setting 字段时用档位 id 解析', A.BF.tts.forcedEngine() === 'mock', A.BF.tts.forcedEngine());
A.settings.ttsEngine = 'auto';

/* 合成入口只问表 */
const B = build(withRow(MOCK_ROW));
const blob = await B.BF.tts.stab.synthesizeWithRetry('北风其凉', 'mock');
ok('退避重试走新档的 synth（不再按名字挑 edge/mimo）',
  blob && blob.tag === 'blob-mock' && B.BF.__mock.synth.join('|') === '北风其凉',
  JSON.stringify(B.BF.__mock.synth));

/* 失败提示读表（走真实入口 handleFailure，不直接够内部函数） */
const C = build(withRow(MOCK_ROW));
C.settings.ttsEngine = 'mock';   /* 显式档：失败不静默换引擎，只报错 + 给动作出口 */
/* 其余档全不可用 → 「临时改用」出口取不到，第四段只剩表里给的那条引导 */
C.flag.edgeAvail = false;
C.BF.tts.mimo.enabled = () => false;
C.BF.tts.offline.available = () => false;
const outC = C.BF.tts.stab.handleFailure('mock', Object.assign(new Error('凭据无效'), { code: 'B' }), { segs: ['句'], pos: 0 });
ok('新档作为显式档同样守住「不静默换引擎」', outC === 'explicit-stop', outC);
const n = C.calls.notices.filter(function (x) { return x.level === 'warn'; })[0] || {};
ok('新档的 B 类提示用表里的根因文案', /根因推测：假引擎的凭据不对/.test(n.m || ''), n.m);
ok('提示动作的按钮名取自表', n.act && n.act.label === '去设置填假密钥', JSON.stringify(n.act && n.act.label));
if (n.act) {
  n.act.run();
  C.calls.timers.forEach(function (t) { try { t[0](); } catch (err) {} });
}
ok('点动作开设置→语音并按表里的 set 聚焦控件',
  C.calls.opens[0] === 'tts' && C.calls.ctl[0] === 'mockSecret',
  C.calls.opens.join(',') + ' / ' + C.calls.ctl.join(','));

/* 探针槽位按表建 */
const st = await C.BF.tts.stab.probe('mock', true);
ok('新档没写 probe 时报未测而不是崩', st === 'unknown', st);
ok('探针结论落进按表建的槽位', !!C.BF.tts.stab._snapshot().probeState.mock);
const st2 = await C.BF.tts.stab.probe('nope', true);
ok('表里没有的名字按不可用处理', st2 === 'down', st2);

/* 阶梯耗尽的文案跟着表走 */
const D = build(withRow(MOCK_ROW));
D.flag.edgeAvail = false;
D.BF.tts.mimo.enabled = () => false;
D.BF.__mock.avail = false;
D.BF.tts.offline.available = () => false;
const rr = D.BF.tts.stab.handleFailure('edge', Object.assign(new Error('断线'), { code: 'D' }), { segs: ['句'], pos: 0 });
const last = D.calls.notices[D.calls.notices.length - 1] || {};
ok('阶梯耗尽时文案列的是表里的档位（不再写死四个名字）',
  rr === 'none' && /假引擎/.test(last.m || '') && /浏览器语音/.test(last.m || ''), last.m);

/* ---------- 插一行本机档（反证：回落终点也来自表） ---------- */
const E = build(withRow(MOCK_NATIVE));
E.flag.edgeAvail = false;
E.BF.tts.mimo.enabled = () => false;
const rung = E.BF.tts.stab.handleFailure('edge', Object.assign(new Error('断线'), { code: 'D' }), { segs: ['甲', '乙'], pos: 1 });
ok('回落终点由表里的 native 行决定（旧写法只会落到 offline）',
  rung === 'mocknat' && E.BF.__mock.play.join(',') === '2,1' && E.BF.__mock.stop === 1,
  'rung=' + rung + ' play=' + E.BF.__mock.play.join(',') + ' stop=' + E.BF.__mock.stop);
ok('浏览器语音那一路没被调用（说明确实按表选档，不是名字兜底）', E.calls.play.length === 0);
ok('新本机档不占冷却名额（非联网档不记引擎级去抖）',
  E.BF.tts.stab._snapshot().coolUntil.mocknat === undefined);
const stE = await E.BF.tts.stab.probe('mocknat', false);
ok('本机档的探针结论是本地事实，不需要 force', stE === 'ok', stE);

/* 音色签名与档位名映射 */
const F = build(withRow(MOCK_ROW));
ok('缓存音色签名取自表（新档自己说清当前用什么声音）',
  F.BF.tts.CAPS.mock.cacheKeyOf() === 'mock|v1' && /^edge\|/.test(F.BF.tts.CAPS.edge.cacheKeyOf()),
  F.BF.tts.CAPS.edge.cacheKeyOf());
ok('Edge 那档的历史值名 online 仍解析到 edge（映射写在表里）',
  F.BF.tts.engOfSetting('online') === 'edge' && F.BF.tts.settingOfEng('edge') === 'online');
ok('未知值名解析为 null：现象是「选不中」，不是「按未知引擎跑」',
  F.BF.tts.engOfSetting('nope') === null && F.BF.tts.forcedEngine() === null);
ok('表外名字取档返回 null（调用方一律按不可用处理）', F.BF.tts.cap('nope') === null);

console.log('\n=== 引擎能力表: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
