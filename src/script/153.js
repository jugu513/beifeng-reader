/* ================= 自动滚动 ================= */
BF.enh.autoScroll = (function () {
  let _on = false, _raf = null, _last = 0, _speed = 3, _takeover = null;
  /* 键盘接管监听在模块级，只绑一次：若每次 start 都向 document 挂 keydown
     而 stop 只解 wheel/touchstart，keydown 永不摘除 →
     反复 start/stop 会叠加多个监听（每次触发都 stop 一次，行为重复）。 */
  function _onKey(e) {
    if (!_on) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === ' ') stop(true);
  }
  let _keyBound = false;
  function _ensureKeyBound() {
    if (_keyBound) return;
    document.addEventListener('keydown', _onKey, { passive: true, capture: true });
    _keyBound = true;
  }
  /* 用户干预即停：rAF 循环若只在「滚到章末」时停，
     滚轮/触摸/方向键手动接管后仍会自动推页面，切到书架后还会空转。 */
  function _bindTakeover(wrap) {
    if (_takeover) return;
    const h = function () { if (_on) stop(true); };
    const opts = { passive: true, capture: true };
    wrap.addEventListener('wheel', h, opts);
    wrap.addEventListener('touchstart', h, opts);
    _ensureKeyBound();
    _takeover = function () {
      try { wrap.removeEventListener('wheel', h, opts); wrap.removeEventListener('touchstart', h, opts); } catch (e) {}
      _takeover = null;
    };
  }
  function start(speed) {
    if (_on) return;
    _on = true;
    _speed = speed || 3;
    _last = Date.now();
    const wrap = document.getElementById('reader-wrap');
    if (!wrap) { _on = false; return; }
    /* 分页模式下容器不可滚动，自动滚动是假功能，直接不启动（否则会空转 rAF 到章末）。
       判据必须用 BF.reader.pageModeActive：'pageMode' 不在 DEFAULTS 里，
       手写这个键名取值恒为 undefined，守卫永远不生效。 */
    if (BF.reader && BF.reader.pageModeActive && BF.reader.pageModeActive()) {
      _on = false;
      BF.noti && BF.noti.info('分页模式下不支持自动滚动');
      return;
    }
    _bindTakeover(wrap);
    function loop() {
      if (!_on) return;
      const now = Date.now();
      const dt = (now - _last) / 1000;
      _last = now;
      wrap.scrollTop += _speed * dt * 60;
      /* 停止条件加 1px 容差：低速时浮点舍入会让 scrollTop 卡在阈值前 1~2px 永不触发 → rAF 空转 */
      if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 1) { stop(); BF.noti.info('已滚动到章末'); return; }
      _raf = requestAnimationFrame(loop);
    }
    _raf = requestAnimationFrame(loop);
  }
  function stop(byUser) {
    if (!_on && !_raf) return;
    _on = false;
    if (_raf) cancelAnimationFrame(_raf); _raf = null;
    if (_takeover) _takeover();
    if (byUser) BF.noti && BF.noti.info('已停止自动滚动（检测到手动操作）');
  }
  function toggle() {
    if (_on) { stop(); return false; }
    /* 速度取设置项 scrollSpeed，缺省 3 */
    start(BF.settings.num('scrollSpeed', 3));
    return _on;
  }
  return { start, stop, toggle, isOn: function () { return _on; } };
})();

