/* ================= A3. AI 密钥存储 + 启动锁（PIN） ================= */
BF.ai.store = (function () {
  function get(k) { return BF.settings.get(k); }
  function set(k, v) { BF.settings.set(k, v); }
  /* PIN 哈希用 PBKDF2-SHA256 ≥10 万次迭代。4 位数字 PIN 只有 1 万种组合，
     单轮 SHA-256(salt+pin) 会被秒级离线爆破（bf_settings 一旦被读走即完）；
     迭代后单次验证约几十毫秒（个人单机可接受），爆破成本抬升
     数个量级。存储格式 pbkdf2$<iter>$<hex>；旧格式（64 位 hex
     单轮 SHA-256 / simple_ 降级哈希）仍可校验，成功后自动升级。 */
  const PIN_ITER = 100000;
  /* 迭代数上限：合法档是 100000，上限只作防卫——存储串里的 iter 由文件自己说了算，
     被改成极高就是「一次验证拖死页面」的入口；低于上限的合法哈希（含旧格式）一概不受影响。 */
  const PIN_CEIL = 500000;
  const LS_PIN_FAIL = 'bf_pin_fail';   /* 失败计数 + 锁定期：防在线枚举 */
  const PIN_MAX_TRIES = 5, PIN_LOCK_MS = 5 * 60 * 1000;
  function _toHex(buf) {
    return Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function _hexEq(a, b) {
    /* 定长比较：避免逐字符提前返回的时序侧信道（个人工具从简，顺手做对） */
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    return d === 0;
  }
  async function pinHashCalc(pin, salt, iter) {
    /* 迭代数取自存好的哈希串本身，所以校验强度不能由存储值说了算：
       低于当前档一律按当前档算（改小的只会验不过，fail-closed）；
       高于上限一律按上限算（改到极高的是脏数据或恶意备份，不该由它拖垮页面）。 */
    const n = Math.min(PIN_CEIL, Math.max(PIN_ITER, Number(iter) || PIN_ITER));
    try {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt + pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: n, hash: 'SHA-256' }, key, 256);
      return 'pbkdf2$' + n + '$' + _toHex(bits);
    } catch (e) {
      /* 仅应为旧数据兼容而降级（pinSet 已在设置前拦截无 Web Crypto 的环境） */
      let h = 0;
      for (const ch of (salt + pin)) h = (h * 31 + ch.charCodeAt(0)) | 0;
      BF.log.warn('PIN 哈希降级为简单哈希');
      return 'simple_' + Math.abs(h).toString(16);
    }
  }
  /* 旧格式校验用：单轮 SHA-256(salt+pin)（含 simple_ 降级） */
  async function _legacyHashCalc(pin, salt) {
    try {
      const data = new TextEncoder().encode(salt + pin);
      return _toHex(await crypto.subtle.digest('SHA-256', data));
    } catch (e) {
      let h = 0;
      for (const ch of (salt + pin)) h = (h * 31 + ch.charCodeAt(0)) | 0;
      return 'simple_' + Math.abs(h).toString(16);
    }
  }
  function _pinFailGet() { try { return BF.store.lsGet(LS_PIN_FAIL, {}) || {}; } catch (e) { return {}; } }
  function _pinFailSet(o) { try { BF.store.lsSet(LS_PIN_FAIL, o); } catch (e) { BF.err.report('pin.failCountWrite', e); } }
  async function pinSet(pin) {
    /* PIN 最少 6 位——4 位仅 1 万组合，配合锁定也挽不回在线枚举；
       上限定 12 位，够长又不难记。 */
    if (!/^\d{6,12}$/.test(pin)) { BF.noti.warn('PIN 需 6-12 位数字'); return; }
    /* 无 Web Crypto（如 file:// 直开）时拒绝设置：subtle 不可用只能降级
       出 simple_ 弱哈希——弱哈希比无锁更危险（给用户虚假安全感），
       与 N9 对弱盐的判断同口径：显式失败，不静默降级。 */
    const secure = typeof crypto !== 'undefined' && !!crypto.subtle;
    if (!secure) {
      BF.noti.error('当前环境不支持 Web Crypto（需通过 https 或 localhost 打开），无法设置安全的启动锁');
      return;
    }
    /* 盐由 crypto.getRandomValues 生成（Math.random 可预测）。 */
    let salt;
    try {
      const _b = new Uint8Array(8);
      crypto.getRandomValues(_b);
      salt = Array.from(_b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      BF.log.error('PIN 盐生成失败（Web Crypto 不可用）', e);
      BF.noti.error('无法生成安全 PIN 盐：当前环境不支持 Web Crypto，启动锁未设置');
      return;
    }
    const hash = await pinHashCalc(pin, salt, PIN_ITER);
    BF.settings.set('pinHash', hash);
    BF.settings.set('pinSalt', salt);
    BF.settings.set('pinLock', true);
    _pinFailSet({ n: 0, until: 0 });   /* 新 PIN 重置失败状态 */
    BF.noti.success('启动锁已设置，下次启动需输入');
  }
  async function pinVerify(pin) {
    const hash = BF.settings.get('pinHash');
    const salt = BF.settings.get('pinSalt');
    /* pinLock=true 但 hash 为空时必须 fail-closed + 明确指引：
       直接放行会让门禁形同虚设（备份恢复后正是此态）。 */
    if (!hash) {
      if (BF.settings.get('pinLock')) {
        BF.noti.error('锁定状态异常（无 PIN 哈希）：请通过「忘记 PIN」清除锁定后重新设置');
        return false;
      }
      return true;
    }
    /* 连续失败锁定——5 次失败锁 5 分钟，锁定期内一律拒绝
       （含正确 PIN），防在线枚举；锁到期自动解除。 */
    const f = _pinFailGet();
    const now = Date.now();
    if (f.until && now < f.until) {
      BF.noti.warn('连续输入错误次数过多，已锁定：请 ' + Math.ceil((f.until - now) / 1000) + ' 秒后再试');
      return false;
    }
    /* 存储的是安全上下文（https/localhost）下生成的哈希，但当前环境不支持
       Web Crypto（如 file:// 直接打开）→ 无法重算；若仍走降级 simple_ 哈希，必与 PBKDF2 不符，
       PIN 永远失败、用户被锁门外且无提示。这里显式 fail-closed：给出明确指引，
       而非算出一个必败哈希。哈希本就是 simple_（非安全语境下设置）时仍按原逻辑校验。 */
    const secure = typeof crypto !== 'undefined' && !!crypto.subtle;
    if (!secure && hash.indexOf('simple_') !== 0) {
      BF.noti.error('当前环境不支持 Web Crypto（需通过 https 或 localhost 打开），无法校验 PIN；请在该环境下启动');
      return false;
    }
    let ok;
    if (hash.indexOf('pbkdf2$') === 0) {
      const iter = parseInt(hash.split('$')[1], 10) || PIN_ITER;
      ok = _hexEq(await pinHashCalc(pin, salt, iter), hash);
    } else {
      /* 旧格式：按原算法校验，成功后顺手升级为 PBKDF2（下次起即新口径） */
      ok = _hexEq(await _legacyHashCalc(pin, salt), hash);
      if (ok) {
        try {
          const nh = await pinHashCalc(pin, salt, PIN_ITER);
          if (nh.indexOf('pbkdf2$') === 0) {
            BF.settings.set('pinHash', nh);
            BF.log && BF.log.info('PIN 哈希已升级为 PBKDF2（' + PIN_ITER + ' 次迭代）');
          }
        } catch (e) {}
      }
    }
    if (ok) { _pinFailSet({ n: 0, until: 0 }); return true; }
    const n = (f.n || 0) + 1;
    if (n >= PIN_MAX_TRIES) {
      _pinFailSet({ n: 0, until: Date.now() + PIN_LOCK_MS });
      BF.noti.error('连续 ' + PIN_MAX_TRIES + ' 次输入错误，已锁定 ' + Math.round(PIN_LOCK_MS / 60000) + ' 分钟');
    } else {
      _pinFailSet({ n: n, until: 0 });
    }
    return false;
  }
  function pinLocked() { return !!BF.settings.get('pinLock'); }
  return { get, set, pinSet, pinVerify, pinLocked };
})();
/* 兼容兜底：BF.settings 上挂 pinXXX 别名——调用点一律走 BF.ai.store，误写 BF.settings.pinXXX 会抛 TypeError，此处一层别名兜底 */
try {
  BF.settings.pinLocked = BF.ai.store.pinLocked;
  BF.settings.pinVerify = BF.ai.store.pinVerify;
  BF.settings.pinSet = BF.ai.store.pinSet;
} catch (e) {}

/* ============================================================
   北风 · ai 域（二）：研读 8 卡 / 工具集 / 摘要缓存 / 问书历史
   ============================================================ */

