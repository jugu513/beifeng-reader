/* ================= 18b. BF.feedback 统一反馈 =================
   「错误态下一步动作」的统一语义层：把散落在各处的 BF.noti.error/warn
   统一为「带下一步动作」的规范提示，并对常见技术错误做中文人话化。
   既有的 BF.noti 仍是其底层；本模块只做语义封装。
   用法：
     BF.feedback.error('保存失败', { next: { label:'重试', run: doRetry } });
     BF.feedback.warn(msg, { next: { label:'去清理', run: openData } });
     BF.feedback.fail('朗读启动失败', err, { next: { label:'重试', run: retry } });
*/
BF.feedback = (function () {
  /* 技术错误 → 人话 + 建议。返回 { text, hint } */
  function humanize(err, fallback) {
    var msg = (err && err.message) ? err.message : (err ? String(err) : '');
    var name = (err && err.name) ? err.name : '';
    var text = fallback || '操作未完成';
    var hint = '';
    if (name === 'QuotaExceededError' || /quota|exceed|空间不足/i.test(msg)) {
      text = '存储空间不足，数据未能保存';
      hint = '请清理标注/备份或导出备份后重试';
    } else if (name === 'NotFoundError' || /not.?found|未找到/i.test(msg)) {
      text = '所需数据未找到';
      hint = '可能已被清理，请刷新或重新导入';
    } else if (name === 'NetworkError' || /network|网络/i.test(msg)) {
      text = '网络异常，请求未成功';
      hint = '请检查网络后重试';
    } else if (name === 'AbortError' || /abort|已取消/i.test(msg)) {
      text = '操作已取消';
      hint = '';
    } else if (name === 'NotAllowedError' || /not.?allowed|权限|denied/i.test(msg)) {
      text = '操作被浏览器拦截（权限不足）';
      hint = '请在浏览器站点设置中允许对应权限';
    } else if (name === 'TimeoutError' || /timeout|超时/i.test(msg)) {
      text = '操作超时';
      hint = '请稍后重试，或检查网络/服务状态';
    } else if ((name === 'SyntaxError' || name === 'TypeError') && /parse|解析|json/i.test(msg)) {
      text = '数据解析失败';
      hint = '文件可能已损坏，请重新导出或导入';
    } else if (name === 'DataError' || /encoding|编码|decode/i.test(msg)) {
      text = '数据编码异常';
      hint = '请确认文件为 UTF-8 编码后重试';
    } else if (msg) {
      /* 没命中模式时保留标题语境：只甩一句技术串，用户不知道是哪个操作失败了 */
      var _m = msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
      text = fallback ? (fallback + '：' + _m) : _m;
    }
    return { text: text, hint: hint };
  }
  function _wrapNext(next) {
    if (next && next.label) {
      return {
        label: next.label,
        run: function () {
          /* next.run 可能是 async（重试链接），只接同步 throw 会把它的拒绝漏成 unhandledrejection */
          try {
            const p = next.run();
            if (p && typeof p.then === 'function') p.catch(function (e) { if (BF.err) BF.err.report('feedback.next', e); });
          } catch (e) { if (BF.err) BF.err.report('feedback.next', e); }
        },
      };
    }
    return null;
  }
  function _emit(type, msg, opts) {
    opts = opts || {};
    var m = msg || '';
    if (opts.detail) m = m + (m ? '：' : '') + opts.detail;
    if (opts.hint && !opts.next) m = m + (m ? '（' : '') + opts.hint + (m ? '）' : '');
    var action = _wrapNext(opts.next);
    if (type === 'error' && BF.noti && BF.noti.error) BF.noti.error(m, action ? { action: action } : undefined);
    else if (type === 'warn' && BF.noti && BF.noti.warn) BF.noti.warn(m, action ? { action: action } : undefined);
    else if (BF.noti && BF.noti.info) BF.noti.info(m, action ? { action: action } : undefined);
  }
  return {
    humanize: humanize,
    error: function (msg, opts) { _emit('error', msg, opts); },
    warn: function (msg, opts) { _emit('warn', msg, opts); },
    info: function (msg, opts) { _emit('info', msg, opts); },
    /* fail：标题 + 错误对象，自动人话化详情并带下一步动作 */
    fail: function (title, err, opts) {
      opts = opts || {};
      var h = humanize(err, title);
      var m = h.text;
      if (opts.detail) m = m + '（' + opts.detail + '）';   /* 调用方传的补充说明不能丢（如「本次未落盘」） */
      if (h.hint && !opts.next) m = m + '（' + h.hint + '）';
      var action = _wrapNext(opts.next);
      if (BF.noti && BF.noti.error) BF.noti.error(m, action ? { action: action } : undefined);
    },
  };
})();

