/* ================= 多音字手动纠正 =================
   引擎读错音的字词，由用户给一段「替读文本」（同音字），合成前替换。
   只改送进引擎的文本，segs 原文不动 —— 高亮定位仍按原句对齐。
   纠正词条存在本机（tts_pron），不上云、不进备份白名单之外的地方。 */
BF.tts.pron = (function () {
  const K = 'tts_pron';
  let _map = null;
  function load() {
    if (_map) return _map;
    try { _map = BF.store.lsGet(K, {}); } catch (e) { _map = {}; }
    if (!_map || typeof _map !== 'object') _map = {};
    return _map;
  }
  function save() { try { BF.store.lsSet(K, _map); } catch (e) {} }
  function set(word, say) {
    const w = String(word || '').trim();
    if (!w) return false;
    load();
    if (say == null || String(say).trim() === '') delete _map[w];
    else _map[w] = String(say).trim();
    save();
    return true;
  }
  function list() { return Object.assign({}, load()); }
  function count() { return Object.keys(load()).length; }
  function apply(t) {
    const m = load();
    let out = t;
    /* 长键先换：先加的短词（如「单」）会吃掉后加的长词（如「单于」），
       按 key 长度降序后才轮到短词，保证「单于」这类长匹配不被截断。 */
    const keys = Object.keys(m).sort(function (a, b) { return b.length - a.length; });
    for (const w of keys) { if (out.indexOf(w) >= 0) out = out.split(w).join(m[w]); }
    return out;
  }
  return { set: set, list: list, count: count, apply: apply };
})();
