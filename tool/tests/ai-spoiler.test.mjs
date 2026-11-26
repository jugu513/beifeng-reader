/* 防剧透召回：未读章不得进入 AI 上下文（含「旧版本整本索引已落盘」的兼容路径）。
   纯逻辑抽取自母本，不复制实现。 */
import vm from 'node:vm';
import { readMaster, extract } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const SIG = 'BF.ai.retrieve = async function (b, question, maxChapters, opts) ';
const code = SIG + extract(src, SIG, '/* ---- Agent 设置建议通道');

const chunks = [
  { ch: 0, off: 0, text: '第一章 甲' },
  { ch: 1, off: 0, text: '第二章 乙' },
  { ch: 5, off: 0, text: '第六章 丙（未读）' },
  { ch: 9, off: 0, text: '第十章 丁（未读）' },
];
const settings = { aiRefBook: true };
const box = {
  BF: {
    ai: {
      _keywords: () => ['词'],
      _rank: (cs) => cs.map((c) => ({ ch: c.ch, off: c.off, score: 1, first: 0 })),
      chunkIdx: { build: async () => chunks },
    },
    library: { getChapterText: async (b, ch) => '正文' + ch },
    appState: { currentChapterIdx: 3 },
    settings: { get: (k) => settings[k] },
  },
  console, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
};
vm.createContext(box);
vm.runInContext(code, box);

const r1 = await box.BF.ai.retrieve({ id: 'b' }, '问', 10, {});
ok('防剧透开：只返回已读章（≤ 当前章）', r1.length === 2 && r1.every((x) => x.idx <= 3), JSON.stringify(r1.map((x) => x.idx)));

settings.aiRefBook = false;
const r2 = await box.BF.ai.retrieve({ id: 'b' }, '问', 10, {});
ok('用户显式允许全书：未读章可以返回', r2.length === 4, JSON.stringify(r2.map((x) => x.idx)));

settings.aiRefBook = true;
box.BF.appState.currentChapterIdx = 9;
const r3 = await box.BF.ai.retrieve({ id: 'b' }, '问', 2, {});
ok('上限与顺序仍生效', r3.length === 2, JSON.stringify(r3.map((x) => x.idx)));

console.log('\n=== 防剧透召回: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
