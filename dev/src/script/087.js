/* ================= 读法规范化 =================
   数字年份按位读、其余整数转中文数值，免得引擎把「2026 年」念成
   「两千零二十六年」。只作用于送合成的文本；三条引擎路径共用一份。
   英文留给引擎自己读 —— 各引擎对英文的处理都好于字符串层面的改写。 */
BF.tts._cnInt = function (n) {
  const D = '零一二三四五六七八九';
  const U = ['', '十', '百', '千'];
  const G = ['', '万', '亿'];
  if (n === 0) return '零';
  if (n >= 10 && n <= 19) return '十' + (n % 10 ? D[n % 10] : '');   /* 十五，不是一十五 */
  let s = String(n), out = '';
  let gi = 0;
  /* 跨组要补零：10001 读「一万零一」而不是「一万一」（后者是 11000）。
     两种情形都要补：低组 1–999（如 10001、10100），以及低组整组为零但更下面
     还有非零组（如 100000001 → 一亿零一）。低组 ≥1000 时连读（一万一千）。 */
  let lowVal = 0, seenLow = false;
  while (s.length > 0) {
    const seg4 = s.slice(-4);
    s = s.slice(0, -4);
    let part = '', pendingZero = false;
    for (let i = 0; i < seg4.length; i++) {
      const d = +seg4[i], u = U[seg4.length - 1 - i];
      if (d === 0) { if (part) pendingZero = true; }
      else { if (pendingZero) { part += '零'; pendingZero = false; } part += D[d] + u; }
    }
    if (part) {
      /* 「一十万」不是标准读法：万位以上开头的 10–19 去掉那个「一」（十万 / 十二万） */
      if (gi > 0 && part.indexOf('一十') === 0) part = part.slice(1);
      const join = (gi > 0 && ((lowVal > 0 && lowVal < 1000) || (lowVal === 0 && seenLow))) ? '零' : '';
      out = part + (G[gi] || '') + join + out;
      seenLow = true;
      lowVal = +seg4;
    } else {
      lowVal = 0;
    }
    gi++;
  }
  return out || '零';
};
BF.tts.normalize = function (t) {
  let s = String(t || '');
  /* 用户纠正优先：显式指定的读法不做二次转换 */
  s = BF.tts.pron.apply(s);
  /* 四位年份（后跟年/届/版/章/回等量词）→ 逐位读 */
  s = s.replace(/(\d{4})(?=[年届版章回])/g, function (_, y) {
    return y.split('').map(function (d) { return '零一二三四五六七八九'[+d] || d; }).join('');
  });
  /* 其余整数（1–12 位）→ 中文数值；小数点读「点」；百分号前置「百分之」 */
  s = s.replace(/(\d+)%/g, '百分之$1');
  s = s.replace(/\d{1,12}(?:\.\d+)?/g, function (m) {
    const dot = m.indexOf('.');
    if (dot < 0) return BF.tts._cnInt(+m);
    return BF.tts._cnInt(+m.slice(0, dot)) + '点' + m.slice(dot + 1).split('').map(function (d) { return '零一二三四五六七八九'[+d] || d; }).join('');
  });
  return s;
};
/* 逐词高亮在在线引擎下永不触发，且必须让用户知道。
   Edge/MiMo 走 WebSocket + decodeAudioData 整段播放，浏览器不产生
   boundary 事件 → BF.tts.state._boundarySeg 全程 null，BF.tts.wordHighlight
   一次都不会被调用；而设置项 ttsWordHighlight 默认 true，用户会以为逐词高亮已生效。
   做法：整句播完仍未收到任何 boundary 时，提示一次
   「逐词高亮在当前引擎不可用，已按整句高亮」，当前会话不再重复。
   「逐词高亮」这一行仍留在通用组：浏览器语音靠 boundary 事件、Edge 靠服务端时间轴，
   两边都可能生效，只有 MiMo 拿不到——不生效时由本函数当场说明，不做静默降级。
   记 _wordHLTold 于播放态，start 时重置（每次新点朗读重新判定）。 */
BF.tts._noteNoBoundary = function (engName) {
  /* 收到过 boundary 就不提示：当次播放逐词高亮确实生效了，不是降级 */
  if (BF.tts.state._boundarySeg) return;
  if (BF.tts.state._wordHLTold) return;
  BF.tts.state._wordHLTold = true;
  BF.noti.info((engName || '在线引擎') + '不提供逐词进度，当前按整句高亮（逐词高亮仅浏览器语音支持）');
};
function speak(segs, from) {
    if (!available()) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    _v1q.clear();
    const idx = from || 0;
    BF.tts.state.pos = idx;
    /* 空转检测：仅离线引擎统计 speak→onend 间隔。
       连续 3 段不足 150ms（典型：无语音包时 utterance 立刻结束）判定为空转，
       自动停止并提示。在线/流式引擎不参与，避免误杀快速短句。 */
    BF.tts.state._idleStart = Date.now();
    BF.tts.state._idleCount = 0;
    /* 心跳监测：离线引擎是主要监护对象（Chromium 长文本
       静默停走是已知 bug）；每句 onstart/onend 即心跳信号 */
    BF.tts.stab.watchdogStart();
    /* 按句单飞：重试配额按「句位」记（本播放内每句至多重试一次）。
       全局单飞标志会让首句重试后整章后续错误都不再重试；
       按重试实例记则每次重试都生成新实例，变成无限重试——必须按句位记 */
    const _retryPos = new Set();
    const mkU = function (n) {
      const u = new SpeechSynthesisUtterance(BF.tts.normalize(segText(segs[n])));
      u.voice = _voice;
      u.rate = BF.settings.num('ttsRate', 1);
      u.pitch = BF.settings.num('ttsPitch', 1);
      u.volume = BF.settings.num('ttsVolume', 0.9);
      if (BF.settings.get('ttsRolePlay') && BF.tts.voiceAlt) {
        try { if (/[“”「」『』]/.test(segText(segs[n]))) u.voice = BF.tts.voiceAlt; } catch (e) {}
      }
      u.onstart = function () { BF.tts.stab.watchdogFeed(); };
      /* 逐词高亮：接入 boundary 事件（前提是 Chrome 中文 boundary 的 charIndex
         与 seg 文本偏移对齐；不触发则保留整句基线，不降级）。逐词高亮由 BF.tts.wordHighlight
         按 charIndex 推进，作为整句底色之上的第二层下划线，底色不清。 */
      u.onboundary = function (ev) {
        if (BF.tts.state._stopIntent) return;
        if (u !== _utterance) return;
        if (BF.settings.get('ttsWordHighlight') === false) return;
        try {
          if (BF.tts.state._boundarySeg !== segs[n]) {
            BF.tts.state._boundarySeg = segs[n];
            BF.tts._clearWordLayer();           /* 换句：只换逐词层，底色随下一句 highlight 重绘 */
          }
          BF.tts.wordHighlight(segs[n], ev.charIndex || 0);
        } catch (e) {}
      };
      u.onend = function () {
        /* 用户已停止（stop 意图），onend 不得重启播放 */
        if (BF.tts.state._stopIntent) return;
        if (u !== _utterance) return;
        BF.tts.stab.watchdogFeed();
        /* 空转检测：仅离线引擎；speak 到 onend 不足 150ms 记一次，连续 3 次判空转 */
        if (BF.tts.state._idleStart != null) {
          const dur = Date.now() - BF.tts.state._idleStart;
          BF.tts.state._idleCount = (dur < 150) ? ((BF.tts.state._idleCount || 0) + 1) : 0;
          BF.tts.state._idleStart = null;
          if (BF.tts.state._idleCount >= 3) {
            BF.tts.state._idleCount = 0;
            BF.tts.stop();
            BF.noti.warn('未检测到可用的中文语音，朗读已停止。可在系统设置中安装中文语音包，或改用在线引擎（设置→语音）');
            return;
          }
        }
        BF.tts.state._errCount = 0;
        /* 离线引擎同样存在「不触发 boundary」的变体
           （部分 Chromium 中文语音包）。整句播完仍无 boundary 就说明
           逐词高亮在当次播放里没生效，提示一次而不是默认开着却无感。 */
        if (BF.settings.get('ttsWordHighlight') !== false && !BF.tts.state._boundarySeg) {
          BF.tts._noteNoBoundary('浏览器语音');
        }
        BF.tts.state.pos++;
        BF.tts.state.wordsRead += segText(segs[BF.tts.state.pos - 1]).length;
        try { if (BF.tts.health) BF.tts.health.notePlayOk(); } catch (e5) {}
        BF.tts._saveSession();   /* 断点续播：逐句回写句号 */
        BF.tts.updateStats();
        if (BF.tts.state.pos < segs.length) {
          /* 下一句的计时起点：只在 speak() 开首句时置一次的话，
             onend 立刻把它清空，_idleCount 最多累到 1，「连续 3 段 <150ms」永不成立。 */
          BF.tts.state._idleStart = Date.now();
          _utterance = mkU(BF.tts.state.pos);
          speechSynthesis.speak(_utterance);
          BF.tts.highlight(segs, BF.tts.state.pos);
        } else {
          BF.tts.segEnd();
        }
      };
      u.onerror = function () {
        /* 用户已停止时不重试 */
        if (BF.tts.state._stopIntent) return;
        if (u !== _utterance) return;
        BF.tts.stab.watchdogFeed();
        BF.tts.state._errCount++;
        if (BF.tts.state._errCount >= 8) { BF.tts.stop(); BF.noti.error('朗读多次失败，已停止'); return; }
        /* 按句单飞：本句位已重试过则不再重试 */
        if (_retryPos.has(n)) return;
        _retryPos.add(n);
        BF.timers.timeout(function () {
          if (BF.tts.state._stopIntent || u !== _utterance) return;
          /* 按句重试：只重讲本句（走 BF.tts.start() 会重启整章，
             首句重试后整章其余部分就放弃了） */
          try { speechSynthesis.cancel(); } catch (e) {}
          _utterance = mkU(BF.tts.state.pos);
          speechSynthesis.speak(_utterance);
        }, 600);
      };
      return u;
    };
    _utterance = mkU(idx);
    speechSynthesis.speak(_utterance);
    BF.tts.highlight(segs, idx);
  }
  function stop() { _v1q.clear(); try { speechSynthesis.cancel(); } catch (e) {} }
  function pause() { try { speechSynthesis.pause(); } catch (e) {} }
  function resume() { try { speechSynthesis.resume(); } catch (e) {} }
  function tryVoice() {
    if (!_voice) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance('北风朗读测试。欢迎使用北风阅读器。');
    u.voice = _voice; u.rate = 1;
    speechSynthesis.speak(u);
  }
  return { available, loadVoices, voice, voices, setVoice, segment, speak, stop, pause, resume, tryVoice, clearQueue() { _v1q.clear(); } };
})();

