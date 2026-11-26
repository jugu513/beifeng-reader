/* ================= PIN 门禁（启动锁 / 敏感操作锁） ================= */
BF.settingsUI.pinGate = function (onPass) {
  let overlay = document.getElementById('pin-gate');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pin-gate';
    overlay.innerHTML =
      '<div style="font-size:18px;font-weight:600">北风已锁定</div>' +
      '<div style="font-size:13px;color:var(--text-weak)">请输入 6-12 位 PIN 解锁</div>' +
      '<input id="pin-input" type="password" inputmode="numeric" maxlength="12" placeholder="PIN" style="font-size:18px;padding:10px 14px;width:220px;text-align:center;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--text)"/>' +
      '<button id="pin-go" class="btn primary" style="width:220px">解锁</button>' +
      '<button id="pin-forgot" class="btn btn-xs" style="color:var(--text-weak)">忘记 PIN？</button>' +
      '<div id="pin-msg" role="status" aria-live="polite" style="font-size:12px;color:var(--danger-ink);height:16px"></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  const input = overlay.querySelector('#pin-input');
  const go = overlay.querySelector('#pin-go');
  const forgot = overlay.querySelector('#pin-forgot');
  const msg = overlay.querySelector('#pin-msg');
  const tryPin = function () {
    const v = (input.value || '').trim();
    if (!v) return;
    BF.ai.store.pinVerify(v).then(function (ok) {
      if (ok) { overlay.style.display = 'none'; try { onPass(true); } catch (e) {} }
      else { msg.textContent = 'PIN 错误'; input.value = ''; input.focus(); }
    });
  };
  go.onclick = tryPin;
  input.onkeydown = function (e) { if (e.key === 'Enter') tryPin(); };
  forgot.onclick = function () {
    BF.ask.confirm({ title: '忘记 PIN', body: '将清除启动锁。PIN 只锁定界面、不加密存储，属防误触 / 防翻看：任何能读到本机存储的人都能直接取走数据。清除后如需保护可重新设置。书籍与笔记数据不受影响。', confirmText: '清除锁定', danger: 2, op: 'pin.forget', facts: {} }).then(function (y) {
      if (y) { BF.settings.set('pinLock', false); BF.settings.set('pinHash', ''); BF.settings.set('pinSalt', ''); overlay.style.display = 'none'; try { onPass(true); } catch (e) {} }
    });
  };
  setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  /* 焦点陷阱：#pin-gate 只是盖住视口的全屏遮罩，背后的整站 DOM 一直在——
     不拦截的话 Tab 能一路走出锁屏、Enter 能触发门底下的按钮，「锁定界面」对键盘形同虚设。
     捕获相统一拦截：门外按键一律收回焦点并阻断传播，门内 Tab 只在
     PIN 框 / 解锁 / 忘记三件间循环。锁屏不是 sheet 层（安全门不许 escTop 关掉），
     但要用 dialog/aria-modal 向辅助技术声明模态性。注册一次防重入。 */
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '启动锁');
  if (!overlay._bfTrap) {
    overlay._bfTrap = true;
    document.addEventListener('keydown', function (e) {
      if (overlay.style.display === 'none') return;
      /* 「忘记 PIN」的 danger 确认框叠在锁屏之上：
         有 sheet 层开着时让位，trap 只守门内，不抢确认框的键。 */
      if (BF.sheet && BF.sheet.anyOpen()) return;
      if (!overlay.contains(e.target)) { e.preventDefault(); e.stopPropagation(); try { input.focus(); } catch (_) {} return; }
      if (e.key === 'Tab') {
        const els = [input, go, forgot];
        const i = els.indexOf(document.activeElement);
        e.preventDefault();
        const j = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i < 0 || i >= els.length - 1 ? 0 : i + 1);
        try { els[j].focus(); } catch (_) {}
      }
    }, true);
  }
};
BF.settingsUI.openPinManage = function () {
  if (BF.ai.store.pinLocked()) {
    BF.modal.prompt('修改 PIN', '输入当前 PIN 验证', { type: 'password' }).then(function (cur) {
      if (cur == null) return;
      BF.ai.store.pinVerify(cur).then(function (ok) {
        if (!ok) { BF.noti.error('当前 PIN 错误'); return; }
        BF.modal.prompt('设置新 PIN', '输入 6-12 位新 PIN（留空则关闭启动锁）', { type: 'password' }).then(function (np) {
          if (np == null) return;
          if (!np.trim()) {
            BF.settings.set('pinLock', false); BF.settings.set('pinHash', ''); BF.settings.set('pinSalt', '');
            BF.noti.success('启动锁已关闭');
          } else { BF.ai.store.pinSet(np.trim()); }
        });
      });
    });
  } else {
    BF.modal.prompt('设置 PIN', '输入 6-12 位数字 PIN（用于启动锁定，防止他人翻看。注：PIN 仅锁定界面，不加密存储）', { type: 'password' }).then(function (np) {
      if (np == null) return;
      if (np.trim()) { BF.ai.store.pinSet(np.trim()); }
    });
  }
};

