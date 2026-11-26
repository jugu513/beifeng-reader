/* 书架进度口径：bookFrac（章序 + 章内分数，按字数加权）与三态判据。
   纯逻辑，从母本按标记抽取；浏览器里的渲染与开关往返归真机验证。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const s = src.indexOf('BF.reader.bookFrac = function');
const e = src.indexOf('BF.reader.updateProgress = function', s);
if (s < 0 || e < 0) { console.error('找不到 bookFrac / shelfState（母本结构变了？）'); process.exit(2); }
const box = { BF: { reader: {}, library: {} }, console };
vm.createContext(box);
vm.runInContext(src.slice(s, e) + '\nthis.__frac = BF.reader.bookFrac; this.__state = BF.library.shelfState;', box);
const frac = box.__frac, state = box.__state;

const book = { totalChapters: 3, wordCount: 300, chapterWords: [100, 100, 100] };

ok('章内分数参与加权（第 1 章读到一半 → 50%）', Math.abs(frac(book, { currentChapter: 1, chapterFrac: 0.5, lastRead: 1 }) - 0.5) < 1e-9, String(frac(book, { currentChapter: 1, chapterFrac: 0.5, lastRead: 1 })));
ok('老数据（有打开痕迹但没 chapterFrac）→ 当前章算满', Math.abs(frac(book, { currentChapter: 1, lastRead: 1 }) - 2 / 3) < 1e-9, String(frac(book, { currentChapter: 1, lastRead: 1 })));
ok('只有章号、没有打开痕迹 → 不算满（新书不该显示读过）', Math.abs(frac(book, { currentChapter: 1 }) - 1 / 3) < 1e-9, String(frac(book, { currentChapter: 1 })));
ok('从没打开过 → 0', frac(book, null) === 0 && frac(book, undefined) === 0 && frac(book, {}) === 0);
ok('脏分数夹到 0–1', frac(book, { currentChapter: 0, chapterFrac: 9 }) === 1 / 3 && frac(book, { currentChapter: 0, chapterFrac: -3 }) === 0);
ok('章号越界夹到末章', Math.abs(frac(book, { currentChapter: 99, chapterFrac: 1 }) - 1) < 1e-9);
ok('无 chapterWords → 章数口径', Math.abs(frac({ totalChapters: 10, wordCount: 0 }, { currentChapter: 4, chapterFrac: 0.5 }) - 0.45) < 1e-9, String(frac({ totalChapters: 10 }, { currentChapter: 4, chapterFrac: 0.5 })));

ok('三态：没打开过 = 未读', state(book, null) === 'new');
ok('三态：停在第 0 章且没动 = 未读', state(book, { currentChapter: 0, chapterFrac: 0, lastRead: Date.now() }) === 'new');
ok('三态：读到一半 = 在读', state(book, { currentChapter: 1, chapterFrac: 0.5, lastRead: Date.now() }) === 'reading');
ok('三态：末章读完 = 读完', state(book, { currentChapter: 2, chapterFrac: 1, lastRead: Date.now() }) === 'done');
ok('三态：99.8% 不算读完（浮点别写 ===1）', state(book, { currentChapter: 2, chapterFrac: 0.994, lastRead: Date.now() }) === 'reading');

console.log('\n=== 书架进度: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
