/* ================= 18.55 BF.taste · 界面口味开关 =================
   一张登记表（BF.TASTE）说了算：设置行、data-taste 令牌、终端开关命令
   全部由它生成。关掉一条就是把名字从令牌里摘掉——CSS 侧每条都挂在
   html[data-taste~="id"] 上，不留第二处状态，也不必为回退改代码。 */
BF.TASTE = [
  { id: 'topline', key: 'tasteTopline', label: '顶栏强调细线', note: '顶栏中央一道渐隐细线' },
  { id: 'poster', key: 'tastePoster', label: '首页海报级', note: '时钟放大、统计格退后一档' },
  { id: 'spring', key: 'tasteSpring', label: '弹性回弹', note: '开关与滑块走过冲曲线' },
  { id: 'stagger', key: 'tasteStagger', label: '页面入场错落', note: '子元素错峰浮起 8px' },
  { id: 'countup', key: 'tasteCountUp', label: '统计数字入场滚动', note: '只滚纯数字，带单位的不骗人' },
  { id: 'slider', key: 'tasteSlider', label: '滑块细轨收游标', note: '轨道 4px；触屏不收游标' },
  { id: 'cardedge', key: 'tasteCardEdge', label: '书卡 0.5px 发丝描边', note: '走 --hairline，不惊动 --border' },
  { id: 'coverlight', key: 'tasteCoverLight', label: '书封左右受光', note: '一道亮边、一道暗边' },
  { id: 'kbd', key: 'tasteKbd', label: '真键帽', note: '快捷键 kbd 下缘加粗' },
  { id: 'favicon', key: 'tasteFavicon', label: '标签页图标随强调色', note: '取当前 --accent 现算' },
  { id: 'scrollbar', key: 'tasteScrollbar', label: '滚动条游标内缩', note: '描边留白，不贴满整槽' },
  { id: 'selection', key: 'tasteSelection', label: '选区走档位色', note: 'DSL 编辑器保留自己的浅蓝' },
  { id: 'eyebrow', key: 'tasteEyebrow', label: '表头眉标化', note: '表格 / 区块标题加小号字距眉标' },
  { id: 'aline-soft', key: 'tasteAlineSoft', label: 'A线·软阴影', note: '卡片阴影改双层柔化，去掉硬边' },
  { id: 'aline-glow', key: 'tasteAlineGlow', label: 'A线·聚焦光环', note: '输入框聚焦加 6px 外发光' },
  { id: 'aline-glass', key: 'tasteAlineGlass', label: 'A线·液态玻璃', note: '顶栏/抽屉/通知毛玻璃化（独立口味，可与 A 线叠加）' },
];
BF.taste = (function () {
  var _favOriginal = null;   /* 只在第一次重染前记一次原 href，关掉能原样还回去 */

  function enabled() {
    return BF.TASTE.filter(function (t) { return !!BF.settings.get(t.key); }).map(function (t) { return t.id; });
  }

  function apply() {
    var list = enabled();
    var el = document.documentElement;
    if (list.length) el.setAttribute('data-taste', list.join(' '));
    else el.removeAttribute('data-taste');
    applyFavicon(list.indexOf('favicon') >= 0);
  }

  /* 强调色读计算样式而不是再抄一份色表：抄一份就是第二个事实源，
     换强调色或换档时必然漂移。取不到就走一个能看的兜底色。 */
  function applyFavicon(on) {
    var link = document.querySelector('link[rel~="icon"]');
    if (!on) {
      if (_favOriginal === null) return;
      if (link && _favOriginal) link.href = _favOriginal;
      else if (link) link.remove();
      _favOriginal = null;
      return;
    }
    if (_favOriginal === null) _favOriginal = link ? link.href : '';
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    var accent = '#c0392b';
    try {
      accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || accent;
    } catch (e) { /* 取不到就用兜底色，不为了一个小图标打断换肤 */ }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="' + accent + '"/>' +
      '<path d="M8 22V10h3.6l4.4 7 4.4-7H24v12h-3v-6.6l-3.6 5.4h-2.8l-3.6-5.4V22z" fill="#fff"/></svg>';
    link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* 数字入场滚动：只动「整段就是数字」的元素。
     「12.3万」这类带单位的文案不动——把 0 滚到 12.3 再显示「万」是自演。
     减少动效开启时直接落真值（值本来就写在那儿，动效只是过程）。 */
  function countUp(root) {
    if (!root || !BF.settings.get('tasteCountUp') || BF.settings.get('reduceMotion')) return;
    var nodes = root.querySelectorAll ? root.querySelectorAll('.num, .stats-nums b') : [];
    Array.prototype.forEach.call(nodes, function (n) {
      var txt = String(n.textContent || '').trim();
      if (!/^[\d,]+(\.\d+)?$/.test(txt)) return;
      var to = parseFloat(txt.replace(/,/g, ''));
      if (!isFinite(to) || to <= 0) return;
      var t0 = 0, dur = 420;
      function frame(ts) {
        if (!t0) t0 = ts;
        const k = Math.min(1, (ts - t0) / dur);
        n.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString();
        if (k < 1) requestAnimationFrame(frame);
        else n.textContent = txt;   /* 收尾必须回到原字符串，动效不许改精度 */
      }
      requestAnimationFrame(frame);
    });
  }

  function toggle(id) {
    var t = null;
    for (var i = 0; i < BF.TASTE.length; i++) { if (BF.TASTE[i].id === id) { t = BF.TASTE[i]; break; } }
    if (!t) return null;
    var next = !BF.settings.get(t.key);
    BF.settings.set(t.key, next);
    apply();
    return { id: id, on: next };
  }

  return { apply: apply, enabled: enabled, countUp: countUp, toggle: toggle };
})();

