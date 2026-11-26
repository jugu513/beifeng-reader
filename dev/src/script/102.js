/* ================= T13. 选区朗读 ================= */
BF.tts.selSpeak = function (text) {
  if (!text) return;
  /* 选区朗读打断整章朗读：不打断就是两路声音叠在一起 */
  try { if (BF.tts.state.playing) BF.tts.stop(); } catch (e) {}
  const eng = BF.tts.pickEngine();
  const cap = BF.tts.cap(eng);
  /* 显式档规则同样覆盖选区朗读：.catch(fallback) 不能无条件静默回落浏览器语音，
     那会绕开「显式档不静默换引擎」的承诺（handleFailure/pickEngine/start
     三处已落实，此路径必须一致）。显式点了联网档时：报错 + 临时改用动作出口
     （四段式文案），不回落；仅自动档回落本机档，
     且回落前先查那一档能不能用，
     不可用则报错，否则本机档缺席时会静默无声 */
  const _fc = BF.tts.cap(BF.tts.forcedEngine());
  const explicitOnline = function () { return !!(_fc && _fc.network); };
  const failNotify = function (e) {
    BF.err.report('tts.selSpeak:' + eng, e);
    const cls = BF.tts.stab.classify(e);
    const handled = (cls.code === 'E') ? '已按限流退避后仍失败'
      : (cls.tier === 'T1') ? '已按瞬时错误退避重试后仍失败'
      : '已记录并停止本次选区朗读';
    const act = BF.tts.stab.tempAction(eng);
    /* 与整章朗读同一条口径：A–G / T1–T4 是诊断码，只进日志，不进吐司 */
    BF.log.info('选区朗读诊断码[' + eng + '] 分类 ' + cls.code + '（' + (BF.tts.stab.CODES[cls.code] || '') + '）·' + (BF.tts.stab.TIERS[cls.code] || ''));
    let msg = '选区朗读失败：' + (cls.message || BF.tts.stab.CODES[cls.code] || '未知原因') + '（已处理：' + handled + '）';
    if (act) msg += '。可点「' + act.label + '」重讲本选区';
    BF.noti.warn(msg, act ? { action: { label: act.label, run: function () {
      act.run();   /* 写入临时改用（内存态，设置本身不动） */
      try { BF.tts.selSpeak(text); } catch (e2) {}
    } } } : undefined);
  };
  const fallback = function () {
    /* 仅自动档回落本机档：先查它能不能用，
       不可用则报错，不静默无声 */
    const n = BF.tts.nativeEngine();
    const nc = BF.tts.cap(n);
    if (!nc || !nc.canUse()) {
      BF.noti.error('选区朗读失败：' + (nc ? nc.label : '本机朗读档') + '不可用（系统未安装中文语音包，或改用在线引擎；见设置→语音）');
      return;
    }
    /* 真落到本机档了，标识要跟着落——否则在线合成失败
       静默回落之后，顶栏仍显示上一次点名的引擎。 */
    BF.tts._setEngine(n);
    nc.playNative(BF.tts.offline.segment(text), 0);
  };
  const playBlob = function (blob) {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.__bfUrl = url;
    BF.tts._stopSel();          /* 上一段选区朗读先停，避免叠音 */
    BF.tts._selAudio = a;
    a.onended = function () { URL.revokeObjectURL(url); if (BF.tts._selAudio === a) BF.tts._selAudio = null; };
    a.play().catch(function (e) { if (explicitOnline()) { failNotify(e); return; } fallback(); });
  };
  /* 选区朗读同样要写 state.engine——它是「联网引擎真在发声、顶栏显示浏览器语音」
     的典型路径（选中一段点朗读）。eng 在函数开头
     就已定下来，这里在真正发起合成前落标识；回落路径由 fallback 单独写。 */
  if (cap && !cap.native) BF.tts._setEngine(eng);
  if (cap && cap.synth) {
    /* 与整章/单击朗读同一读法：不规范化会让年份、整数、多音字在两条路径上念得不一样 */
    cap.synth(BF.tts.normalize(text)).then(playBlob).catch(function (e) { if (explicitOnline()) { failNotify(e); return; } fallback(); });
  } else {
    fallback();
  }
};

