/* 只读对账：把「用户能看见的数字与枚举」与代码真值逐条比对。
   文案里写「九档外观」而代码里有十档，用户照着找就找不到——这类毛病
   靠眼睛读是查不完的，且每加一档就会再错一次。
   不进产品、不进闸门；退出码始终 0（它是清单，不是判据）。

   用法：node tool/fact-check.mjs [母本路径]
   新增一档 / 一条命令 / 一个引擎时，在 SPEC 里加一行即可。 */
import fs from 'node:fs';

import { TARGET, GATE } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const gateSrc = fs.existsSync(GATE) ? fs.readFileSync(GATE, 'utf8') : '';

/* 中文数字 → 阿拉伯（只覆盖文案里会出现的小数） */
const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cn2num(t) {
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '十') return 10;
  const m = String(t).match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
  return CN[t] !== undefined ? CN[t] : NaN;
}

/* 截一段源码：从起始锚点到第一个 `\n};`（函数体）或指定收尾 */
function slice(from, until) {
  const i = src.indexOf(from);
  if (i < 0) return '';
  const j = src.indexOf(until, i);
  return src.slice(i, j < 0 ? i + 4000 : j);
}
function quoted(body) { return (body.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)); }

/* 用户可见文案 = 字符串/模板字面量里的内容；注释不参与对账 */
const strings = src.match(/'[^'\n]{0,400}'|"[^"\n]{0,400}"|`[^`]{0,600}`/g) || [];
function claims(re) {
  const out = [];
  for (const s of strings) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(s))) {
      const said = (m.slice(1).find((x) => x !== undefined) || '').trim();
      out.push({ said, in: s.replace(/\s+/g, ' ').slice(0, 96) });
    }
  }
  return out;
}

const SPEC = [
  {
    what: '外观档数量',
    truth: () => quoted(slice('BF.SKINS = [', '];')).length || null,
    said: /([一二两三四五六七八九十\d]+)\s*档外观/,
  },
  {
    what: '色板数量（明暗四档之外的色板）',
    truth: () => {
      const ids = quoted(slice('BF.SKINS = [', '];'));
      const n = ids.filter((id) => ['light', 'dark', 'black', 'system'].indexOf(id) < 0).length;
      return n || null;
    },
    said: /([一二两三四五六七八九十\d]+)\s*张色板/,
  },
  {
    what: '朗读引擎数量（能力表 BF.tts.CAPS 的行数）',
    truth: () => {
      /* 择优逻辑已从 pickEngine 的 if 链改成一张能力表：一行一档。
         数行不够，还得认得出文案点名的这三家，否则随便三个 id 也能糊过去。 */
      const body = slice('BF.tts.CAPS = {', '\n};');
      const ids = ['offline', 'edge', 'mimo'].filter((e) => new RegExp("id: '" + e + "'").test(body));
      const rows = (body.match(/^\s+id: '/gm) || []).length;
      return ids.length === 3 ? rows || null : null;
    },
    said: /([一二两三四五六七八九十\d]+)\s*种(?:朗读)?引擎/,
  },
  {
    what: '脚本权限档数',
    truth: () => {
      const m = src.match(/PERM_LEVELS\s*=\s*\[([\s\S]*?)\]/);
      if (m) return quoted(m[1]).length;
      return /'read'/.test(src) && /'data'/.test(src) && /'full'/.test(src) && /'secrets'/.test(src) ? 4 : null;
    },
    said: /权限分([一二两三四五六七八九十\d]+)档/,
  },
  /* 说明：「询问分几档」这类没有单一真值来源（档位规则散在确认中枢里、
     还刻意不留第二份表）的条目不进来——对账工具报假不一致，
     比不报更坏：报多了就没人看这个清单了。 */
  {
    what: '界面口味开关数（BF.TASTE 的 key 条数）',
    truth: () => {
      const body = slice('BF.TASTE = [', '\n];');
      const n = (body.match(/key:/g) || []).length;
      return n || null;
    },
    said: /([一二两三四五六七八九十\d]+)\s*(?:道|条)(?:界面)?口味/,
  },
  {
    what: '书卡常驻动作上限（BOOK_CARD_MAX）',
    truth: () => {
      const m = src.match(/BOOK_CARD_MAX\s*=\s*(\d+)/);
      return m ? Number(m[1]) : null;
    },
    said: /最多\s*([一二两三四五六七八九十\d]+)\s*枚/,
  },
  {
    what: '按字数分章默认值（DEFAULTS.chapterWordCount）',
    truth: () => {
      const m = src.match(/chapterWordCount:\s*(\d+)/);
      return m ? Number(m[1]) : null;
    },
    said: /每\s*(\d{4,6})\s*字[（(]?分/,
  },
  {
    what: '内联 style 棘轮上限（闸门 ⑫）',
    truth: () => {
      const m = gateSrc.match(/INLINE_STYLE_CEIL\s*=\s*(\d+)/);
      return m ? Number(m[1]) : null;
    },
    said: null,
  },
];

let bad = 0, ok = 0, noClaim = 0;
for (const c of SPEC) {
  const truth = c.truth();
  const list = c.said ? claims(c.said) : [];
  if (!list.length) {
    console.log(`  ── ${c.what}：代码真值 ${truth}（文案里没有可比对的数字声明）`);
    noClaim++;
    continue;
  }
  for (const k of list) {
    const said = cn2num(k.said);
    const same = truth !== null && said === truth;
    if (same) ok++; else bad++;
    console.log(`${same ? '  ✓' : '  ✗'} ${c.what}：文案说「${k.said}」（=${said}）· 代码真值 ${truth}`);
    if (!same) console.log(`      出处 ${k.in}`);
  }
}
console.log(`\n对账：一致 ${ok} · 不一致 ${bad} · 无可比对声明 ${noClaim}`);
if (bad) console.log('不一致的每条都要落到「改文案」或「改代码」上——以用户看得见的为准。');
