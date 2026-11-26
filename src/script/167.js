/* ================= 18.5 BF.act 用户动作统一包装 ================= */
/* 反馈强度矩阵（契约，不是新机器）——每个用户动作的反馈强度
   由三层既有机制唯一决定，不允许任何调用点绕过：
     询问强度 = BF.ask 四档（0 不打扰 / 1 单击确认 / 2 后果确认·禁不再询问 / 3 敲 y），
       档位由 op 名单 + cap 推导（写入口唯一、破坏必有回响）；
     执行反馈 = BF.act.run 三通道（失败必有 BF.feedback.fail 人话化 + 下一步 ·
       可逆成功 = 「（Ctrl+Z 可撤销）」吐司带撤销按钮 · 不可逆成功默认静默，
       需要时显式 opts.success；反馈通道唯一）；
     完成引导 = BF.next 动作对象长在完成态上（toast 的 action 或屏内动作区按钮），
       只接真实可执行的下一步，没有下一步就不放按钮。
   新增强度=改这三层的规则，禁止在调用点私设"第三种反馈"。 */
/* 把"用户触发的写动作"统一包一层——进度登记→异常捕获→失败人话化
   （原因 + 下一步动作）→ 成功确认。失败必有反馈，成功保持安静不打扰。
   长任务可传 opts.job: true 接入 BF.jobs 顶栏芯片（begin/end/fail 三态统一
   登记，芯片接口不可用时降级为无芯片，不阻断动作）；
   可传 opts.undo（函数）登记撤销（typeof 校验，与 BF.undo.push 一致）。 */
BF.act = (function () {
  function run(label, fn, opts) {
    opts = opts || {};
    /* 按 BF.jobs 既有模式（begin → end/fail）登记任务芯片。
       begin 不可用或抛异常时降级为无芯片，不阻断动作本身。 */
    var jobId = null;
    if (opts.job && BF.jobs && BF.jobs.begin) {
      try { jobId = BF.jobs.begin(label, { kind: 'async' }); } catch (e) { jobId = null; }
    }
    function done(ok, err, quiet) {
      /* 任务芯片终态：成功 end、失败 fail（互斥，与 _jobEndOk/_jobFail 同口径） */
      if (jobId) {
        try {
          if (ok) { if (BF.jobs.end) BF.jobs.end(jobId); }
          else if (BF.jobs.fail) { BF.jobs.fail(jobId, err); }
        } catch (e) {}
      }
      if (!ok) {
        /* 反馈调用包 try/catch——promise 路径不落 unhandled rejection
           （沙箱缺 BF.feedback 时不崩）。quiet：调用方已经出过声，不叠第二条。 */
        if (!quiet) { try { BF.feedback.fail(label, err, { next: opts.next, detail: opts.detail }); } catch (eF) { if (BF.err) BF.err.report('act.feedback', eF); } }
        if (opts.onFail) { try { opts.onFail(err); } catch (e2) {} }
      } else {
        /* typeof 校验与 BF.undo.push 内部校验（非函数拒收）一致 */
        if (typeof opts.undo === 'function' && BF.undo && BF.undo.push) {
          try { BF.undo.push({ label: label, undo: opts.undo }); } catch (e4) { if (BF.err) BF.err.report('act.undo', e4); }
        }
        try { if (opts.success) BF.feedback.info(opts.success, opts.next ? { next: opts.next } : undefined); } catch (eI) { if (BF.err) BF.err.report('act.feedback', eI); }
        if (opts.onOk) { try { opts.onOk(); } catch (e3) {} }
      }
    }
    try {
      var r = fn();
      if (r && typeof r.then === 'function') {
        r.then(function (v) {
          /* resolve(false) 是调用方约定的「没生效」（删除写不进去等）：
             当成成功会触发成功提示并往撤销栈压一条假记录。 */
      if (v === false) done(false, new Error('操作未生效'), true);   /* 调用方通常已自带回执，不叠第二条 */
          else done(true);
        }).catch(function (e) { done(false, e); });
      } else {
        done(true);
      }
    } catch (e) {
      done(false, e);
    }
  }
  return { run: run };
})();

