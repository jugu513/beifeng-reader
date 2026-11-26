/* ================= 10. 全局事件委托 ================= */
BF.delegate = (function () {
  const _clickMap = new Map();
  const _changeMap = new Map();
  function onClick(selector, handler) { _clickMap.set(selector, handler); }
  function onChange(selector, handler) { _changeMap.set(selector, handler); }
  function _matchEl(el, selector) {
    /* closest 本就包含自身起点，先 matches 再 closest 是每次点击×每个
       注册选择器白跑一遍全匹配。 */
    if (!el || !el.closest) return null;
    return el.closest(selector) || null;
  }
  function _upDepth(from, to) {
    let d = 0, n = from;
    while (n && n !== to) { d++; n = n.parentElement; }
    return n ? d : Infinity;
  }
  // 命中层级最近者优先（最具体的按钮胜出），修复卡片根 data-open-book 抢走子按钮的 bug
  function _pick(e, mapObj) {
    let best = null, bestD = Infinity;
    for (const [sel, handler] of mapObj) {
      const m = _matchEl(e.target, sel);
      if (m) {
        const d = _upDepth(e.target, m);
        if (d < bestD) { bestD = d; best = { sel, handler, el: m }; }
      }
    }
    return best;
  }
  document.addEventListener('click', function (e) {
    const hit = _pick(e, _clickMap);
    if (hit) { try { hit.handler(e); } catch (err) { BF.err.report('delegate.click:' + hit.sel, err); } }
  });
  document.addEventListener('change', function (e) {
    const hit = _pick(e, _changeMap);
    if (hit) { try { hit.handler(e); } catch (err) { BF.err.report('delegate.change:' + hit.sel, err); } }
  });
  return { onClick, onChange };
})();

