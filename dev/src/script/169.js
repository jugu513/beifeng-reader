/* ================= 20. BF.modal Promise 模态框 ================= */
BF.modal = (function () {
  function _show(html, onRender, onClose) {
    const box = document.getElementById('modal-box');
    if (!box) return;
    box.innerHTML = html;
    /* 模态不自己记账：开合 / 滚动锁 / 焦点归还 / Tab 陷阱全交 BF.sheet
       （单一实现，避免各调用点各抄一份、彼此漂移）。
       tier:'overlay' 是行为保真：确认框常年开在设置面板 / DSL 之上。 */
    /* refocus：确认框/输入框套确认框时 #modal-bg 一直是开着的，只是内容换了 ——
       内容换了就要把焦点交给新内容，这条与「面板内换栏不抢焦点」是两回事。 */
    BF.sheet.open('modal-bg', { refocus: true,
      cls: 'show', tier: 'overlay', onClose: onClose,
      render: function () { if (onRender) { try { onRender(box); } catch (e) { BF.err.report('modal.render', e); } } },
    });
    /* Tab 循环陷阱由 sheet 装（见上），判据走 sheet 的统一实现。 */
  }
  function _hide() { BF.sheet.close('modal-bg'); }
  function prompt(title, placeholder, opts) {
    opts = opts || {};
    const ptype = opts.type === 'password' ? 'password' : 'text';
    /* 可选 opts.validate(value) -> 错误文案字符串；返回非空则原地报错、不关闭、不 resolve，
       输入变化时清除错误。无 validate 时行为完全不变（向后兼容，不改公共契约）。 */
    const _validate = (typeof opts.validate === 'function') ? opts.validate : null;
    return new Promise(function (res) {
      let settled = false;
      const done = function (v) { if (settled) return; settled = true; _hide(); res(v); };
      _show(
        '<h3 style="margin-bottom:12px;font-size:16px">' + BF.dom.esc(title) + '</h3>' +
        '<input class="input" id="modal-prompt-input" type="' + ptype + '" placeholder="' + BF.dom.escAttr(placeholder || '') + '" style="width:100%;margin-bottom:16px" value="' + BF.dom.escAttr(opts.value || '') + '"/>' +
        '<div class="modal-prompt-err" id="modal-prompt-err" role="alert" aria-live="assertive"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" data-modal-cancel>取消</button>' +
        '<button class="btn btn-sm primary" data-modal-ok>确定</button>' +
        '</div>',
        function (box) {
          const input = box.querySelector('#modal-prompt-input');
          const errEl = box.querySelector('#modal-prompt-err');
          input.focus();
          function _showErr(msg) { if (errEl) { errEl.textContent = msg || ''; errEl.classList.toggle('show', !!msg); } }
          if (input) input.addEventListener('input', function () { if (errEl) _showErr(''); });
          function _ok() {
            if (_validate) { const _r = _validate(input ? input.value : ''); if (_r) { _showErr(_r); if (input) input.focus(); return; } }
            done(input ? input.value : '');
          }
          box.querySelector('[data-modal-ok]').onclick = _ok;
          box.querySelector('[data-modal-cancel]').onclick = function () { done(null); };
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _ok(); } });
        },
        function () { done(null); }
      );
    });
  }
  function alert(title, content, opts) {
    /* content 默认转义：新增调用点忘了转义就是存储型 XSS（书名、标注文本都走这条）。
       要真 HTML（按钮/换行排版）的调用点显式传 { html: true }。 */
    const _body = (opts && opts.html)
      ? String(content == null ? '' : content)
      : BF.dom.esc(content == null ? '' : content).replace(/\n/g, '<br>');
    return new Promise(function (res) {
      let settled = false;
      const done = function () { if (settled) return; settled = true; _hide(); res(); };
      _show(
        '<h3 style="margin-bottom:12px;font-size:16px">' + BF.dom.esc(title) + '</h3>' +
        '<div style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:16px">' + _body + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm primary" data-modal-ok>确定</button>' +
        '</div>',
        function (box) { box.querySelector('[data-modal-ok]').onclick = function () { done(); }; },
        function () { done(); }
      );
    });
  }
  /* 自定义内容弹窗：confirm 只有「确定/取消」两态，遇到「加密/明文/取消」三选一
     会被迫把其中一态绑到取消键上（误按 Esc 就导出明文）。此接口把按钮与语义完全交给调用方。 */
  function custom(title, bodyHtml, onRender, onEsc) {
    /* Esc 必须有兜底：confirm/prompt 各自监听 Esc 并在关闭时解绑，custom 交给调用方，
       若调用方没处理，遮罩会锁死（ovLock 已加但 ovUnlock 不会触发）。
       onRender(box, dismiss) —— 调用方关闭弹窗时务必调 dismiss 解绑 Esc。 */
    /* Esc 兜底监听由 sheet 统一挂装（这里再挂每次调用漏一个解绑，
       且非 Esc 关闭不通知调用方）。
       dismiss 的含义不变：调用方自己处理过关闭 → 关闭通知不再走 onEsc。 */
    let answered = false;
    /* T6：dismiss 必须把弹窗真正关掉——此前它只是置 answered 标志，
       导致导出备份等只调 dismiss() 的弹窗「取消无效 / 导出成功后仍停留」，只有 Esc 能关。
       现在 dismiss 与 Esc / 遮罩点击共用 _hide 同一出口（onClose 见 answered 已置位即跳过，不会重复触发）。 */
    let dismiss = function () { answered = true; _hide(); };
    _show(
      '<h3 style="margin-bottom:12px;font-size:16px">' + BF.dom.esc(title) + '</h3>' + bodyHtml,
      function (box) { if (onRender) { try { onRender(box, dismiss); } catch (e) { BF.err.report('modal.render', e); dismiss(); } } },
      function () {
        if (answered) return;
        const box = document.getElementById('modal-box');
        const cancelBtn = box && box.querySelector('[data-modal-cancel],[data-bk-cancel]');
        if (cancelBtn) { try { cancelBtn.click(); return; } catch (_) {} }
        /* 无取消按钮时必须显式回调 onEsc（若有），让调用方能 resolve(false)/清理——
           只 _hide 不通知，其外层 Promise 会永久 pending。 */
        try { if (typeof onEsc === 'function') onEsc(); } catch (_) {}
      }
    );
    return dismiss;
  }
  /* 遮罩点击关闭：#modal-bg 除按钮与 Esc 外，点半透明遮罩本身也应可关
     （与代码库别处覆盖层组件 `if (e.target === overlay) close()` 的惯例一致）。
     与 Esc 同一出口：点中 #modal-bg 自身即 _hide → sheet.close → onClose，
     prompt/alert 落 done(null)、custom 走取消按钮或 onEsc，语义与 Esc 完全一致；
     点 #modal-box 内任何元素（含其 padding）因 e.target 不是 #modal-bg 不会误关。 */
  document.addEventListener('click', function (e) {
    if (e.target !== document.getElementById('modal-bg')) return;
    if (BF.sheet.isOpen('modal-bg')) _hide();
  });
  return { prompt, alert, custom, hide: _hide };
})();

/* ============================================================
   BF.ask —— 统一询问框架

   「不懂就问、会问才问」：常规操作零打扰，只在真正需要人决策时打断。
   本模块是确认询问的唯一入口与统一风险四档语义；
   既有模块体不动，由各危险操作逐步切换消费。

   风险四档（danger，0-3 或同名小写英文）：
     0 不问    只读 / 可逆 / 语义明确（翻页、搜索、改字号）→ 直接放行，不弹窗
     1 一般    批量可逆 / 首次新能力 → 按钮确认，可「不再询问」
     2 危险    不可逆但有范围 → 后果确认，禁「不再询问」，回车=取消
     3 密钥级  涉密钥 / 全量不可逆 → 须回复 y 才放行，回车=取消

   设计约束：
   - 问前先验：发问前先经 facts / verify 查数据层拿真值；拿不到真值就
     降级文案（占位符渲染为 ? + 警示行），绝不带着假设问、绝不说「已/成功」。
   - 默认取消：回车 = 取消；危险操作不提供「默认执行」（确认按钮非首选焦点，
     requireY 模式下未输入 y 前确认按钮禁用）。
   - 记忆抑制仅适用于可逆操作（档 ≤1）；danger≥2 每次都问。
   - 与权限体系叠加去重：能力级已授，操作级不重复问（danger≥2 除外）。
   - 失败关闭：框架自身出错时 resolve(false)，绝不静默放行。
   ============================================================ */
BF.ask = (function () {
  /* ---- 风险四档 ---- */
  var TIER = { NONE: 0, GENERAL: 1, DANGER: 2, SECRET: 3 };
  var TIER_NAME = ['none', 'general', 'danger', 'secret'];
  var TIER_LABEL = ['不问', '一般', '危险', '密钥级'];

  function parseTier(v) {
    if (typeof v === 'number' && isFinite(v)) {
      var n = Math.floor(v);
      return n >= 0 && n <= 3 ? n : null;   /* 越档视为未声明 */
    }
    if (typeof v === 'string') {
      var t = v.trim().toLowerCase();
      if (t === 'none' || t === '0' || t === 'quiet' || t === 'silent' || t === 'auto') return 0;
      if (t === 'general' || t === '1' || t === 'normal' || t === 'info') return 1;
      if (t === 'danger' || t === '2' || t === 'warn' || t === 'risky') return 2;
      if (t === 'secret' || t === '3' || t === 'key' || t === 'secret-key') return 3;
    }
    return null;
  }

  /* 只读 / 可逆的已知操作（未显式声明 danger 时自动归 0 档）。
     已注册到中枢的能力按 cap 类判定（见 classify），此表只兜底未注册操作。 */
  var READ_PREFIXES = ['nav.', 'find.', 'stats.', 'help.', 'sys.', 'noti.', 'ws.'];
  var READ_EXACT = ['read.next', 'read.prev', 'read.fontSize', 'read.font-size',
    'read.zoomIn', 'read.zoomOut', 'read.autoscroll',
    'read.bookmark', 'read.continue', 'theme.cycle'];

  function isReadOnlyOp(op) {
    if (!op) return false;
    if (READ_EXACT.indexOf(op) >= 0) return true;
    for (var i = 0; i < READ_PREFIXES.length; i++) {
      if (op.indexOf(READ_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function hubCapClass(op) {
    try {
      if (BF.hub && typeof BF.hub.get === 'function') {
        var c = BF.hub.get(op);
        if (c && c.cap) return c.cap;
      }
    } catch (e) {}
    return null;
  }

  /* cap 类 → 风险档（与中枢权限口径镜像：密钥=3，破坏性=2，写=1，读/导航=0） */
  function capClassTier(cls) {
    if (!cls) return null;
    if (cls === 'secrets:read' || cls === 'secrets:write') return 3;
    if (cls === 'cmd:danger') return 2;
    if (cls === 'store:write' || cls === 'settings:write' || cls === 'settings:raw' || cls === 'cmd:write') return 1;
    /* 已知读/导航类（中枢真实登记的 cap）：0 档不问。
       classify 先查 cap 类，若此处不显式
       列读/导航类，「未列出→1」会把导航/AI 读取
       误升为一般档（每次询问）。 */
    if (cls === 'cmd:navigate' || cls === 'store:read' || cls === 'cmd:read') return 0;
    /* 未列出的 cap 类 → 1（宁可多问一次）：
       中枢新登记的 cap 类不能静默按
       只读放行，要与中枢「默认拒绝优于猜测放行」的
       约定一致。 */
    return 1;
  }

  /* 四档判定：显式声明优先 → 中枢 cap 类 → 只读表兜底 → 默认 1（宁可多问一次）。
     cap 类（中枢能力映射）判定必须先于只读前缀表 ——
     已注册到中枢的操作以中枢 cap 为权威（只读表只兜底
     未注册操作）；若只读表在前、命中前缀即短路，
     已注册操作的 cap 声明会被跳过（如中枢登记为写类的
     操作若恰带只读前缀会被误判 0 档不问）。 */
  function classify(opts) {
    opts = opts || {};
    var given = parseTier(opts.danger);
    if (given !== null) return given;
    if (opts.dangerous === true) return 2;
    var op = opts.op || opts.id || '';
    if (op) {
      var t = capClassTier(hubCapClass(op));
      if (t !== null) return t;
      if (isReadOnlyOp(op)) return 0;
    }
    return 1;
  }

  /* ---- 记忆（「不再询问」）：本次会话 / 永久 ----
     键名带 op 前缀；记录 { e: 已确认范围, ts }。
     仅档 ≤1 的可逆操作可记忆；danger≥2 禁止（每次都问）。 */
  var MEM_S = 'ask_s:';   /* 会话级（sessionStorage，不可用时退化为进程内替身） */
  var MEM_F = 'ask_f:';   /* 永久级（localStorage） */
  var _sesWritten = {};   /* 会话级写过的 op（sessionStorage 无法按前缀枚举，供 forgetAll 清理） */
  var _onceMem = {};      /* 「本次」档：进程内态，不落任何存储——
                              「本次」语义即不跨刷新保留，重开页面即失效；
                              若写进 sessionStorage 就变成「本次会话」，
                              与语义不符 */

  function sesGet(k, d) {
    try {
      if (BF.store && typeof BF.store.ssGet === 'function') {
        var v = BF.store.ssGet(k, undefined);
        if (v !== undefined) return v;
      }
    } catch (e) {}
    try {
      if (BF.store && typeof BF.store.memGet === 'function') return BF.store.memGet(k, d);
    } catch (e) {}
    return d;
  }
  function sesSet(k, v) {
    try { if (BF.store && typeof BF.store.ssSet === 'function') BF.store.ssSet(k, v); } catch (e) { BF.log && BF.log.warn('storage.会话写入失败：' + (e && e.message)); }
    try { if (BF.store && typeof BF.store.memSet === 'function') BF.store.memSet(k, v); } catch (e) { BF.log && BF.log.warn('storage.内存写入失败：' + (e && e.message)); }
  }
  function sesRemove(k) {
    try { if (BF.store && typeof BF.store.ssRemove === 'function') BF.store.ssRemove(k); } catch (e) { BF.log && BF.log.warn('storage.会话删除失败：' + (e && e.message)); }
    try { if (BF.store && typeof BF.store.memRemove === 'function') BF.store.memRemove(k); } catch (e) { BF.log && BF.log.warn('storage.内存删除失败：' + (e && e.message)); }
  }

  /* 范围（extent）归一化：数组 → 集合；标量 → 单项；null/undefined → null（未声明范围） */
  function normExtent(e) {
    if (e == null) return null;
    if (Array.isArray(e)) {
      var out = [];
      for (var i = 0; i < e.length; i++) {
        if (e[i] != null && e[i] !== '') {
          var s = String(e[i]);
          if (out.indexOf(s) < 0) out.push(s);
        }
      }
      return out;
    }
    return [String(e)];
  }
  /* 新范围是否被已确认范围覆盖：next 为 null 视为「无参数操作」，
     仅当 prev 也是空数组（同为无参数）才算覆盖。 */
  function extentCovers(prev, next) {
    if (!prev) return false;
    if (!next) return prev.length === 0;
    for (var i = 0; i < next.length; i++) {
      if (prev.indexOf(next[i]) < 0) return false;
    }
    return true;
  }
  function extentUnion(prev, next) {
    var base = prev ? prev.slice() : [];
    if (next) {
      for (var i = 0; i < next.length; i++) {
        if (base.indexOf(next[i]) < 0) base.push(next[i]);
      }
    }
    base.sort();
    return base;
  }
  function memRead(op) {
    var out = { session: null, forever: null, once: null };
    try { out.session = sesGet(MEM_S + op, null); } catch (e) { out.session = null; }
    try { out.forever = (BF.store && typeof BF.store.lsGet === 'function') ? BF.store.lsGet(MEM_F + op, null) : null; } catch (e) { out.forever = null; }
    out.once = _onceMem[op] || null;   /* 「本次」档：进程内态 */
    return out;
  }
  function memWrite(op, scope, extent) {
    var cur = memRead(op)[scope];
    var prevE = (cur && Array.isArray(cur.e)) ? cur.e : [];
    var rec = { e: extentUnion(prevE, extent), ts: Date.now() };
    try {
      if (scope === 'forever') {
        if (BF.store && typeof BF.store.lsSet === 'function') return BF.store.lsSet(MEM_F + op, rec);
        return false;
      }
      if (scope === 'session') {
        sesSet(MEM_S + op, rec);
        _sesWritten[op] = true;
        return true;
      }
      /* 「本次」档：只写进程内态 _onceMem ——
         三档共用会话写入会把「本次」升级成
         「本次会话」（重开同标签页仍抑制询问），与
         「本次」语义（不落任何存储）不符。 */
      _onceMem[op] = rec;
      return true;
    } catch (e) { return false; }
  }
  function memoryCovers(op, extent) {
    if (!op) return false;
    var m = memRead(op);
    var next = normExtent(extent);
    if (extentCovers(m.once && m.once.e, next)) return true;     /* 「本次」档 */
    if (extentCovers(m.session && m.session.e, next)) return true;
    if (extentCovers(m.forever && m.forever.e, next)) return true;
    return false;
  }

  /* 能力级已授？委托 hub._capAllowed 唯一实现 ——
     此处复制一份档位表会与中枢双实现必漂移 —— 任何一侧改规则另一侧静默不一致，
     询问型确认就会问错对象。
     hub 缺失时 fail-closed 返回 false。 */
  function permAllows(cls) {
    try {
      if (!BF.hub || typeof BF.hub._capAllowed !== 'function') return false;
      return !!BF.hub._capAllowed(cls);
    } catch (e) { return false; }
  }
  function capGranted(opts) {
    try {
      if (opts.cap && BF.hub && typeof BF.hub.describe === 'function') {
        var list = BF.hub.describe();
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === opts.cap) return !!list[i].allowed;
        }
        return false;   /* 未注册能力不视为已授 —— 宁多问一次 */
      }
      if (opts.capClass) return permAllows(opts.capClass);
    } catch (e) {}
    return false;
  }

  /* ---- 后果文案模板：{key} 占位 ----
     返回 { html, text, missing }：html 供界面（值一律 esc，防数据层 XSS），
     text 供 aria-live 播报（去标签）。未核实或缺键 → 占位符渲染为「?」，绝不脑补。 */
  function renderTemplate(body, facts, verified) {
    body = String(body == null ? '' : body);
    var missing = false;
    var escFn = function (s) { return BF.dom.esc(s); };
    function fill(s, esc) {
      return s.replace(/\{(\w+)\}/g, function (_, k) {
        if (!verified || !facts || !Object.prototype.hasOwnProperty.call(facts, k)) { missing = true; return '?'; }
        var v = facts[k];
        return esc ? esc(v == null ? '?' : String(v)) : String(v);
      });
    }
    var html = fill(body, escFn);
    var text = fill(body.replace(/<[^>]*>/g, ''), null);
    return { html: html, text: text, missing: missing };
  }

  /* ---- 焦点陷阱：Tab 在弹窗内循环，不外溢 ---- */
  function trapTab(e, box) {
    try {
      var nodes = box.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!nodes || !nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !box.contains(active)) { if (e.preventDefault) e.preventDefault(); last.focus(); }
      } else {
        if (active === last || !box.contains(active)) { if (e.preventDefault) e.preventDefault(); first.focus(); }
      }
    } catch (err) {}
  }

  /* HTML 转义（界面文案一律经此，防数据层 XSS） */
  function esc(s) {
    return BF.dom.esc(s);
  }

  var _open = false;   /* 询问弹窗互斥：模态框是单例，并发询问失败关闭 */

  /* 是否处在 DSL 执行中（终端或脚本）。判定读 BF.dsl 的那一份真源，
     本地不留副本——两套档位表/上下文表必然漂移，漂移后询问会问错对象。
     取不到标记（没有 BF.dsl）= 不在脚本里；取的时候抛错 = 按在脚本里算，
     本框架的失败关闭方向是多问、要敲字，不是放行。 */
  function inDsl() {
    try { return !!(BF.dsl && typeof BF.dsl.isScript === 'function' && BF.dsl.isScript()); }
    catch (e) { return true; }
  }

  function showDialog(opts, ctx) {
    return new Promise(function (resolve) {
      if (_open || !BF.modal || typeof BF.modal.custom !== 'function') {
        try { if (BF.err && typeof BF.err.report === 'function') BF.err.report('ask.conflict', new Error('已有询问弹窗打开或 BF.modal 不可用')); } catch (_) {}
        /* 单例互斥下第二次询问被拒必须出声：脚本 Promise.all 触发两个破坏性动作时，
           用户只看到一个弹窗，另一个「已取消」不能只留在日志里。 */
        try { BF.noti && BF.noti.warn('已有确认框打开，本次操作已取消'); } catch (_) {}
        resolve(false);
        return;
      }
      _open = true;
      var settled = false;
      var keyFn = null;

      var tierBadge = '';
      if (ctx.tier >= 2) {
        tierBadge = '<div style="font-size:12px;color:var(--danger-ink);margin-bottom:8px">⚠ ' + TIER_LABEL[ctx.tier] + '操作（' + ctx.tier + ' 档）</div>';
      }
      var verifiedLine = ctx.verified
        ? '<div style="font-size:12px;color:var(--success-ink);margin-top:8px">✓ 后果已按当前数据核实</div>'
        : '<div style="font-size:12px;color:var(--warning-ink);margin-top:8px">⚠ ' +
          (ctx.tpl.missing ? '未能核实实际影响（占位符显示为 ?）' : '本次询问未附可核实的数据') +
          '，请按最坏情况评估后再决定</div>';

      var html =
        '<div style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:12px">' +
        tierBadge + ctx.tpl.html + verifiedLine + '</div>' +
        (ctx.requireY
          ? '<div style="margin-bottom:12px"><label for="ask-y" style="display:block;font-size:12px;color:var(--text-weak);margin-bottom:6px">密钥级操作须人工确认：请输入 <b>y</b>：</label>' +
            '<input class="input" id="ask-y" data-ask-y type="text" inputmode="latin" autocomplete="off" spellcheck="false" placeholder="y" style="width:100%"/>' +
            '<div style="font-size:11px;color:var(--text-weak);margin-top:4px">未输入 y 时确认按钮保持禁用，回车视为取消。</div></div>'
          : '') +
        (ctx.tier <= 1
          ? '<label class="dlg-check" style="margin-bottom:12px;color:var(--text-weak)">' +
            '<input type="checkbox" data-ask-nomore/> 不再询问' +
            '<select class="input" data-ask-scope style="width:auto;padding:2px 6px;font-size:12px">' +
            '<option value="once">本次</option>' +
            '<option value="session"' + (ctx.scope === 'session' ? ' selected' : '') + '>本次会话</option>' +
            '<option value="forever"' + (ctx.scope === 'forever' ? ' selected' : '') + '>永久</option>' +
            '</select></label>'
          : '') +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-sm" data-modal-cancel>' + esc(opts.cancelText || '取消') + '</button>' +
        '<button class="btn btn-sm primary' + (ctx.tier >= 2 ? ' danger' : '') + '" data-ask-ok' + (ctx.requireY ? ' disabled' : '') + '>' + esc(opts.confirmText || (ctx.tier === 3 ? '继续执行' : '确认')) + '</button>' +
        '</div>' +
        '<div data-ask-live role="status" aria-live="assertive" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></div>';

      BF.modal.custom(ctx.title, html, function (box, dismiss) {
        /* 无障碍：alertdialog 语义 + aria-live 播报询问内容 */
        try {
          box.setAttribute('role', 'alertdialog');
          box.setAttribute('aria-modal', 'true');
          box.setAttribute('aria-label', ctx.title);
        } catch (e) {}
        var live = box.querySelector('[data-ask-live]');
        if (live) {
          live.textContent = ctx.title + '。' + ctx.tpl.text + '。' +
            (ctx.verified ? '后果已按当前数据核实。' : '未能核实实际影响，请按最坏情况评估。') +
            (ctx.requireY ? '需输入 y 确认。' : '回车=取消；焦点在确认按钮上时回车=确认。');
        }

        var okBtn = box.querySelector('[data-ask-ok]');
        var cancelBtn = box.querySelector('[data-modal-cancel]');
        var yInput = ctx.requireY ? box.querySelector('[data-ask-y]') : null;
        var noMore = box.querySelector('[data-ask-nomore]');
        var scopeSel = box.querySelector('[data-ask-scope]');

        var finish = function (v) {
          if (settled) return;
          settled = true;
          _open = false;
          if (keyFn) { try { document.removeEventListener('keydown', keyFn, true); } catch (e) {} keyFn = null; }
          try { dismiss(); } catch (e) {}
          try { if (BF.modal && typeof BF.modal.hide === 'function') BF.modal.hide(); } catch (e) {}
          /* 记忆写入仅在「确认且勾选不再询问」时发生（档 ≤1 才可能走到这里） */
          if (v === true && noMore && noMore.checked && scopeSel) {
            memWrite(ctx.op, scopeSel.value, ctx.extent);
          }
          resolve(v === true);
        };

        if (okBtn) okBtn.onclick = function () { finish(true); };
        if (cancelBtn) cancelBtn.onclick = function () { finish(false); };
        if (yInput && okBtn) {
          var syncY = function () {
            okBtn.disabled = ((yInput.value || '').trim().toLowerCase() !== 'y');
          };
          yInput.addEventListener('input', syncY);
          yInput.addEventListener('keyup', syncY);
          syncY();
        }

        /* 回车默认取消：只有焦点在「确认」按钮上时才是确认
           （<button> 的标准激活键就是 Enter，capture 拦截后必须自己给出同义行为）。 */
        keyFn = function (e) {
          if (e.key === 'Enter') {
            /* 多行输入（textarea）里 Enter 应换行，不被 capture 拦截成确认/取消。
               当前弹窗仅 <input>、无 textarea，属预防性硬化。 */
            const tg = e.target && e.target.tagName;
            if (tg === 'TEXTAREA') return;
            const _onOk = !!(e.target && e.target.closest && e.target.closest('[data-ask-ok]'));
            if (_onOk) {
              if (ctx.requireY && yInput && (((yInput.value || '').trim().toLowerCase()) !== 'y')) return;
              if (e.preventDefault) e.preventDefault();
              finish(true);
              return;
            }
            if (e.preventDefault) e.preventDefault();
            if (ctx.requireY && yInput) {
              finish(((yInput.value || '').trim().toLowerCase() === 'y'));
            } else {
              finish(false);
            }
            return;
          }
          if (e.key === 'Tab') trapTab(e, box);
        };
        try { document.addEventListener('keydown', keyFn, true); } catch (e) {}
      });
    });
  }

  /* 入口：BF.ask.confirm({ title, body, danger, scope, requireY, op, extent,
     facts, verify, cap, capClass, force, confirmText, cancelText })
     返回 Promise<boolean>：true = 用户确认执行。 */
  function confirm(opts) {
    opts = opts || {};
    var op = opts.op || opts.id || '';
    var tier = classify(opts);

    /* 档 0：不问 —— 只读/可逆/语义明确，直接放行 */
    if (tier === 0) return Promise.resolve(true);

    return Promise.resolve()
      .then(function () {
        /* 问前先验：优先用调用方已核实的事实，否则经 verify 查数据层；
           verify 失败降级为「未核实」继续问，绝不带着假设问 */
        if (opts.facts != null && typeof opts.facts === 'object') return opts.facts;
        if (typeof opts.verify === 'function') {
          return Promise.resolve().then(function () { return opts.verify(); }).catch(function () { return null; });
        }
        return null;
      })
      .then(function (facts) {
        var factsOK = !!(facts && typeof facts === 'object');
        var tpl = renderTemplate(opts.body != null ? opts.body : opts.content, factsOK ? facts : null, factsOK);
        /* 模板缺占位（tpl.missing）即未核实 ——
           facts 是对象不代表键齐全，占位符渲染为「?」（facts 缺键）时
           宣称「后果已按当前数据核实」不实。
           缺占位时 verified=false，界面回「未能核实实际影响」
           警示行，不谎报已核实。 */
        var verified = factsOK && !tpl.missing;

        /* 权限叠加去重：能力级已授 → 操作级不重复问（danger≥2 除外） */
        /* DSL 路径不去重：脚本一次性触发几十个破坏操作时，能力级授权
           挡不住「后面几十个人都没看」——那正是需要逐条确认的地方。 */
        if (tier < 2 && !opts.force && !inDsl() && capGranted(opts)) return true;
        /* 记忆抑制：同类操作已确认且范围未超出 → 不再问 */
        if (tier <= 1 && !opts.force && !inDsl() && memoryCovers(op, opts.extent)) return true;

        return showDialog(opts, {
          op: op, tier: tier, verified: verified, tpl: tpl,
          extent: normExtent(opts.extent),
          title: opts.title || '确认',
          requireY: opts.requireY === true || tier === 3 || (tier >= 2 && inDsl()),
          scope: (opts.scope === 'session' || opts.scope === 'forever') ? opts.scope : 'once',
          confirmText: opts.confirmText, cancelText: opts.cancelText
        });
      })
      .then(function (v) { return v === true; })
      .catch(function (e) {
        /* 失败关闭：询问框架自身出错时绝不放行 */
        _open = false;
        try { if (BF.err && typeof BF.err.report === 'function') BF.err.report('ask.confirm', e); } catch (_) {}
        return false;
      });
  }

  /* 清除记忆：「设置项可改回」的入口（永久记忆可随时按 op 撤销） */
  function forget(op) {
    if (!op) return;
    try { sesRemove(MEM_S + op); } catch (e) {}
    delete _sesWritten[op];
    delete _onceMem[op];   /* 「本次」档 */
    try { if (BF.store && typeof BF.store.lsRemove === 'function') BF.store.lsRemove(MEM_F + op); } catch (e) { BF.err.report('ask.forgetCleanup', e); }
  }
  function forgetAll() {
    var ops = [];
    for (var k in _sesWritten) { if (Object.prototype.hasOwnProperty.call(_sesWritten, k)) ops.push(k); }
    /* 「本次」档：进程内态无存储键可枚举，
       只能遍历 _onceMem 记账 */
    for (var k2 in _onceMem) { if (Object.prototype.hasOwnProperty.call(_onceMem, k2) && ops.indexOf(k2) < 0) ops.push(k2); }
    try {
      if (BF.store && typeof BF.store.lsKeys === 'function') {
        var keys = BF.store.lsKeys();
        for (var i = 0; i < keys.length; i++) {
          if (keys[i] && keys[i].indexOf(MEM_F) === 0) ops.push(keys[i].slice(MEM_F.length));
        }
      }
    } catch (e) { BF.log && BF.log.warn('store.清理枚举失败，本次「清除数据」可能只清掉一部分：' + (e && e.message)); }
    for (var j = 0; j < ops.length; j++) forget(ops[j]);
    return ops.length;
  }

  return {
    confirm: confirm,
    classify: classify,
    template: renderTemplate,
    forget: forget,
    forgetAll: forgetAll,
    memory: memRead,
    TIER: TIER,
    TIER_NAME: TIER_NAME,
    TIER_LABEL: TIER_LABEL,
    parseTier: parseTier,
    isReadOnlyOp: isReadOnlyOp,
    isOpen: function () { return _open; },
    busy: function () { return _open; }   /* 询问框占用中：脚本时限据此暂停 */
  };
})();

