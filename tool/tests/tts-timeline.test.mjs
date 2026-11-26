/* 在线朗读时间轴：audio.metadata 解析单元测试（只读母本，不改产品）。

   验的是「解析」这一段：100ns→ms、词/句分流、坏帧只记一次错、空载荷不产时间轴。
   播放侧的时间轴推进在浏览器里用假 WebSocket 走完整链路验（见本轮复核回执），
   这里只保证解析本身的形状对——这条通路本机 Edge 端点 403，解析错了没有别的地方能发现。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const startMark = 'function _edgeTakeMeta(rec, bytes) {';
const endMark = '/* 收尾（turn.end';
const s = src.indexOf(startMark);
const e = src.indexOf(endMark, s);
if (s < 0 || e < 0) { console.error('找不到 _edgeTakeMeta（母本结构变了？）'); process.exit(2); }
const body = src.slice(s, e);

const errors = [];
const sandbox = {
  TextDecoder,
  BF: { err: { report: (tag, err) => errors.push(tag) } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(body + '\nthis.__take = _edgeTakeMeta;', sandbox);
const take = sandbox.__take;

function mkRec() { return { meta: null }; }

/* 1. 基本形态：两个词 + 一句，100ns → ms */
{
  const rec = mkRec();
  take(rec, new TextEncoder().encode(JSON.stringify({
    Metadata: [
      { Type: 'WordBoundary', Data: { Offset: 1000000, Duration: 2500000, text: { Text: '北风' } } },
      { Type: 'WordBoundary', Data: { Offset: 3500000, Duration: 1500000, text: { Text: '其凉' } } },
      { Type: 'SentenceBoundary', Data: { Offset: 0, Duration: 5000000, text: { Text: '北风其凉' } } },
    ],
  })));
  ok('词边界解析出两条', rec.meta && rec.meta.words.length === 2, JSON.stringify(rec.meta && rec.meta.words));
  ok('Offset 100ns → ms（1000000 → 100）', rec.meta.words[0].ms === 100 && rec.meta.words[0].dur === 250);
  ok('第二条词边界毫秒正确（3500000 → 350）', rec.meta.words[1].ms === 350 && rec.meta.words[1].dur === 150);
  ok('句边界单独分流', rec.meta.sents.length === 1 && rec.meta.sents[0].txt === '北风其凉');
  ok('正常帧不报错', errors.length === 0);
}

/* 2. 坏帧：只记一次错，不抛、不污染已收内容 */
{
  const rec = mkRec();
  take(rec, new TextEncoder().encode(JSON.stringify({
    Metadata: [{ Type: 'WordBoundary', Data: { Offset: 20000, Duration: 10000, text: '好' } }],
  })));
  const before = JSON.stringify(rec.meta);
  let threw = false;
  try { take(rec, new TextEncoder().encode('{坏 JSON')); } catch (e) { threw = true; }
  take(rec, new TextEncoder().encode('{又坏'));
  ok('坏帧不抛异常', !threw);
  ok('坏帧只记一次错', errors.length === 1, '共 ' + errors.length + ' 次');
  ok('坏帧不影响已解析内容', JSON.stringify(rec.meta) === before);
}

/* 3. 空 / 缺字段：不产时间轴，不报错 */
{
  const rec = mkRec();
  take(rec, new TextEncoder().encode('{}'));
  take(rec, new TextEncoder().encode(JSON.stringify({ Metadata: [] })));
  ok('空载荷不建时间轴', rec.meta === null);
  const rec2 = mkRec();
  take(rec2, new TextEncoder().encode(JSON.stringify({ Metadata: [{ Type: 'Unknown', Data: {} }] })));
  ok('未知类型不写入', rec2.meta === null);
}

/* 4. 与播放侧的契约：时间轴按朗读文本取回 */
{
  const tlStart = src.indexOf('const _tl = new Map();');
  const tlEnd = src.indexOf('function _edgeTakeMeta', tlStart);
  const tlBody = src.slice(tlStart - 0, tlEnd);
  const box = { console };
  vm.createContext(box);
  vm.runInContext(tlBody + '\nthis.__for = timelineFor; this.__put = _tlPut;', box);
  const meta = { words: [{ ms: 0, dur: 300, txt: '甲' }], sents: [] };
  box.__put('甲句', meta);
  ok('按文本取回同一份时间轴', box.__for('甲句') === meta);
  ok('未登记的文本返回 null', box.__for('乙句') === null);
  box.__put('空轴', { words: [], sents: [] });
  ok('空时间轴不入表', box.__for('空轴') === null);
}

console.log('\n=== 时间轴解析: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
