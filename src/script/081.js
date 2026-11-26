/* ================= R13. 查找（章内 Ctrl+F） ================= */
BF.findInPage = (function () {
  let _q = '', _matches = [], _cur = -1, _capped = false;
  /* 防抖句柄必须与 _q/_matches 同级 —— close() 在 open() 闭包外，
     若把 _scanT 声明在 open() 里，close() 清不到「已排队的最后一次扫描」。 */
  let _scanT = null;
  let _escGrabOn = false;
  /* 命中数上限：达到即停止扫描，并如实标「结果不完整」——
     只 break 不上报时 updateCount 会把被截断的 5000 当精确总数显示，
     用户以为「只有这 5000 条」，实际还有更多。 */
  const FIND_MAX = 5000;
  /* 焦点跑掉之后的 Esc 兜底。查找框不是 sheet 层（只是一个贴在 body 上的小条），
     浮层栈的 escTop 管不到它：用户点了一下正文或选区工具条，焦点离开输入框，
     再按 Esc 就什么都没发生——框还挂着，看起来像「按了没反应」。
     捕获取决顺序：本监听在 document 捕获阶段先于启动区那个（bubble）跑，
     因此能在面板被关之前读到「此刻有没有面板开着」。
     一次按键只关一层：面板开着时把这次 Esc 整条让给面板（不截断传播），
     只有栈空时才由查找框消费。 */
  function _escGrab(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!document.getElementById('bf-find-box')) return;
    if (BF.sheet && BF.sheet.anyOpen()) return;
    e.stopPropagation();
    close();
  }
  function open() {
    if (BF.appState.currentPage !== 'reader') { BF.noti.warn('请先打开一本书'); return; }
    const box = document.getElementById('bf-find-box');
    if (box) { box.remove(); }
    if (_scanT) { clearTimeout(_scanT); _scanT = null; }
    const b = document.createElement('div');
    b.id = 'bf-find-box';
    b.innerHTML = '<input id="bf-find-input" placeholder="在章内查找..." style="width:180px" class="input"/><span id="bf-find-count" style="font-size:11px;color:var(--text-weak);min-width:40px;white-space:nowrap"></span><button class="btn btn-xs" data-find="prev" aria-label="上一处匹配" title="上一处匹配">↑</button><button class="btn btn-xs" data-find="next" aria-label="下一处匹配" title="下一处匹配">↓</button><button class="btn btn-xs" data-find="close" aria-label="关闭查找" title="关闭查找">×</button>';
    document.body.appendChild(b);
    const input = b.querySelector('#bf-find-input');
    input.focus();
    /* 防抖 150ms：每敲一个字符就对整章做一次全量 TreeWalker + indexOf，大章输入会明显卡顿 */
    input.addEventListener('input', function () {
      _q = input.value; _matches = []; _cur = -1;
      if (_scanT) clearTimeout(_scanT);
      _scanT = setTimeout(function () { _scanT = null; scan(); }, 150);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); }
      /* Esc 只关查找框自己：必须截断传播，否则同一个 Esc 继续冒到
         启动区的 escTop，把底下开着的面板一起关掉——一次按键拆掉两层。 */
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    b.querySelector('[data-find="prev"]').onclick = function () { jump(-1); };
    b.querySelector('[data-find="next"]').onclick = function () { jump(1); };
    b.querySelector('[data-find="close"]').onclick = function () { close(); };
    if (!_escGrabOn) { document.addEventListener('keydown', _escGrab, true); _escGrabOn = true; }
  }
  function close() {
    const box = document.getElementById('bf-find-box');
    if (box) box.remove();
    if (_escGrabOn) { document.removeEventListener('keydown', _escGrab, true); _escGrabOn = false; }
    clearMarks();
    /* 关框即弃——在途防抖计时器、命中表与整节文本节点引用必须一起清掉：
       否则框关了计时器还会跑一次全量 scan，引用链拖住 detached 节点不放。 */
    if (_scanT) { clearTimeout(_scanT); _scanT = null; }
    _matches = []; _q = ''; _cur = -1; _capped = false;
  }
  function scan() {
    const rm = document.getElementById('reader-main');
    const paras = BF.reader.state.paras || [];
    if ((!rm && !paras.length) || !_q) { _matches = []; _capped = false; updateCount(); return; }
    _matches = [];
    const ql = _q.toLowerCase();
    /* 虚拟化长章只渲染窗口段，TreeWalker 扫 DOM 会假阴性（搜不到明明存在的词）。
       优先扫内存 paras 数组（全章数据），命中记为 {vi（段索引）, off（段内偏移）}。
       非虚拟化（DOM 即全章）保持 TreeWalker 路径。 */
    if (paras.length) {
      for (let vi = 0; vi < paras.length; vi++) {
        /* 小写化每段一次——原在命中 while 里每次命中重造整段小写串，
           大章搜高频词是 O(段长×命中数) */
        const low = (paras[vi] || '').toLowerCase();
        let pos = 0;
        while ((pos = low.indexOf(ql, pos)) !== -1) {
          _matches.push({ vi: vi, off: pos, len: _q.length });
          pos += _q.length;
          if (_matches.length >= FIND_MAX) break;
        }
        if (_matches.length >= FIND_MAX) break;
      }
    } else if (rm) {
      const walker = document.createTreeWalker(rm, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const low = node.textContent.toLowerCase();
        let pos = 0;
        while ((pos = low.indexOf(ql, pos)) !== -1) {
          _matches.push({ node: node, pos: pos, len: _q.length });
          pos += _q.length;
          if (_matches.length >= FIND_MAX) break;
        }
        if (_matches.length >= FIND_MAX) break;
      }
    }
    _cur = -1;
    _capped = _matches.length >= FIND_MAX;
    updateCount();
  }
  function jump(dir) {
    if (!_matches.length) return;
    _cur = (_cur + dir + _matches.length) % _matches.length;
    clearMarks();
    const m = _matches[_cur];
    if (!m) return;
    updateCount();   /* 计数渲染单一走 updateCount（含触顶「结果不完整」标注），不在这里各写一份 */
    /* 内存段命中（虚拟化）→ 用 gotoCharOffset 定位到段；
       非虚拟化保持 DOM 高亮路径。 */
    if (typeof m.vi === 'number') {
      const paras = BF.reader.state.paras || [];
      /* 段前缀和走 BF.cfi 唯一实现 */
      const abs = BF.cfi.locToOffset({ si: m.vi, so: m.off }, paras);
      BF.reader.gotoCharOffset(abs, { highlight: true, q: _q });
      return;
    }
    const rm = document.getElementById('reader-main');
    if (!rm) return;
    /* DOM 命中的 _matches 本就存着 {node,pos}——连按 ↓/Enter 直接用缓存；
       仅当该节点已被上一次套色拆分/换章脱离文档时，才回退整篇重扫重建索引。 */
    let found = null;
    if (m.node && rm.contains(m.node) && m.pos + m.len <= m.node.textContent.length) {
      found = { node: m.node, pos: m.pos, len: m.len };   /* 缓存节点仍在原位，直接用 */
    }
    if (!found) {
      const ql = (_q || '').toLowerCase();
      const walker = document.createTreeWalker(rm, NodeFilter.SHOW_TEXT);
      let node, idx = -1;
      while ((node = walker.nextNode())) {
        const text = node.textContent.toLowerCase();
        let pos = 0;
        while ((pos = text.indexOf(ql, pos)) !== -1) {
          idx++;
          if (idx === _cur) { found = { node: node, pos: pos, len: _q.length }; break; }
          pos += _q.length;
        }
        if (found) break;
      }
      if (found) { m.node = found.node; m.pos = found.pos; }   /* 索引回填，后续按键免重扫 */
    }
    if (!found) return;
    const range = document.createRange();
    range.setStart(found.node, found.pos);
    range.setEnd(found.node, found.pos + found.len);
    const mark = document.createElement('mark');
    mark.style.background = 'var(--accent)'; mark.style.color = '#000';
    try { range.surroundContents(mark); } catch (e) { BF.err.report('findInPage.jump', e); }
    mark.scrollIntoView({ block: 'center' });
  }
  function clearMarks() {
    const rm = document.getElementById('reader-main');
    if (rm) rm.querySelectorAll('mark').forEach(function (m) {
      const parent = m.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(m.textContent), m);
    });
  }
  function updateCount() {
    const count = document.getElementById('bf-find-count');
    if (!count) return;
    if (!_matches.length) { count.textContent = _q ? '无结果' : ''; return; }
    /* 「0/5000」会被读成「0 个结果」：还没跳转时报共几处，跳转后才报第几处。
       触顶时总数写 5000+ —— 后面那句「不完整」才有分量。 */
    const _total = _capped ? FIND_MAX + '+' : String(_matches.length);
    count.textContent = _cur >= 0
      ? (_cur + 1) + ' / ' + _total + (_capped ? '（不完整）' : '')
      : _total + ' 处' + (_capped ? '（不完整）' : '');
  }
  return { open, close, _scan: scan, _jump: jump, _clearMarks: clearMarks };
})();

