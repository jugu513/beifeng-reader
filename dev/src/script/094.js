/* ================= T6. 主朗读流程 ================= */
BF.tts._clearSleep = function () { if (BF.tts._sleepT) { BF.tts._sleepT(); BF.tts._sleepT = null; } };
BF.tts.preview = function () {
  const sample = '这是一段北风朗读的试听示例，用于检验语速、音调和音量是否合适。';
  /* 试听与整章朗读互斥：两路同时出声是事故（在线档不会自己 cancel 任何东西） */
  try { if (BF.tts.state.playing) BF.tts.stop(); } catch (e) {}
  const eng = BF.tts.pickEngine();
  const cap = BF.tts.cap(eng);
  /* 阶梯走空（所有档都不可用）时别去试 Edge：那会报一条「Edge 试听失败」，
     而真正的事实是「现在没有可用引擎」 */
  if (!cap) { BF.noti.warn('当前没有可用的朗读引擎，无法试听（检查设置→语音的引擎开关与凭据）'); return; }
  /* 浏览器代管播放的档没有「合成一次再解码」这条路：直接喂 speechSynthesis。
     native 就是这个意思，所以这里判能力不判名字。 */
  if (cap && cap.native) {
    try { speechSynthesis.cancel(); } catch (e) {}
    BF.tts._speakUtterance(sample, 'tts.preview');
    BF.noti.info('试听中（离线）');
    return;
  }
  const EN_PREVIEW = cap ? cap.label : eng;
  const ac = BF.tts._audioCtx || (BF.tts._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
  /* 试听失败也要落探针态：只有解码成功才 noteProbe(eng,'ok')、
     失败的两条 catch 静默吞掉异常不留痕迹的话，设置面板试听失败
     什么都看不见，用户以为能用，进正文才炸；三态灯与健康探针还会
     停在另一次探测的结论。失败按分类落态（限流 E 归受限，其余归不可用），
     并把分类带进提示，用户一眼看出是哪类失败、该不该继续折腾。 */
  const previewFail = function (what, e) {
    const stab = BF.tts.stab;
    const cls = stab.classify(e);
    stab.noteProbe(eng, cls.code === 'E' ? 'limited' : 'down');
    BF.log.info('试听失败[' + eng + '] 分类 ' + cls.code + '（' + (stab.CODES[cls.code] || '') + '）·' + cls.tier + '：' + what);
    /* 诊断码只进日志；给用户的是人话 + 该不该继续折腾。
       同一条失败出口：预览的两条 catch 也走这里，不再各写一套文案。 */
    BF.noti.error(EN_PREVIEW + ' 试听失败（' + what + '）：' + (cls.message || stab.CODES[cls.code] || '未知原因'));
  };
  const doPlay = function (blob) {
    blob.arrayBuffer().then(function (ab) {
      ac.decodeAudioData(ab).then(function (buf) {
        const src = ac.createBufferSource(); src.buffer = buf;
        const g = ac.createGain(); g.gain.value = BF.settings.num('ttsVolume', 0.9);
        /* 试听音源入册：停止按钮必须能停掉它（局部变量 stop() 看不见） */
        BF.tts._stopTap();
        BF.tts._tapSrc = src;
        src.onended = function () { if (BF.tts._tapSrc === src) BF.tts._tapSrc = null; };
        src.connect(g); g.connect(ac.destination); src.start();
        BF.noti.info('试听中（' + EN_PREVIEW + '）');
        /* 按需健康探针触发②：试听成功即引擎健康 */
        BF.tts.stab.noteProbe(eng, 'ok');
      }).catch(function (e) { previewFail('音频解码失败', e); });
    }).catch(function (e) { previewFail('音频读取失败', e); });
  };
  /* 试听只测单次连接（不走重试链），按钮文案已写明这一点。
     合成入口取能力表的 synth：加一档引擎不必回来补一条 if。 */
  if (!cap || !cap.synth) { BF.noti.warn(EN_PREVIEW + ' 不产音频字节，无法试听'); return; }
  cap.synth(sample).then(doPlay).catch(function (e) { previewFail('合成失败', e); });
};
BF.tts.start = function (opts) {
  /* 用户显式启动朗读 → 清除停止意图标志（stop 会置位） */
  BF.tts.state._stopIntent = false;
  /* 会话代次：start 的 .then 链是异步的，连点朗读时两个 start
     同时活着，各自拉起一条播放循环 —— 双声、串句、字数翻倍。
     每次start递增代次：过期的 start 在拿到正文后自弃，
     onlineSpeak 的 play 循环也在每步比对，旧循环不得越过新会话继续。 */
  BF.tts.state._sess = (BF.tts.state._sess || 0) + 1;
  const _mySess = BF.tts.state._sess;
  /* 每次新点朗读重置「已提示过逐词不可用」，
     让当次播放重新判定；同一次播放内由 _noteNoBoundary 保证只提示一次。 */
  BF.tts.state._wordHLTold = false;
  BF.tts.state._boundarySeg = null;
  BF.tts._clearSleep();
  try { BF.tts.offline.stop(); } catch (e) {}
  BF.tts._pfClear && BF.tts._pfClear();
  /* 重开/切引擎时旧在线音源不会自己停：start 只清预取，两路声音会叠在一起 */
  const _oldSrc = BF.tts.state._src;
  BF.tts.state._src = null;
  if (_oldSrc) { try { _oldSrc.stop(); } catch (e) {} try { _oldSrc.disconnect(); } catch (e) {} }
  /* 可用性判定综合 pickEngine 结果：已配置 MiMo/Edge 在线引擎时，
     即便浏览器无本地 speechSynthesis 也应允许朗读；仅当所有引擎都不可用时才提示不支持 */
  const _eng0 = BF.tts.pickEngine();
  const _cap0 = BF.tts.cap(_eng0);
  const _localOk0 = !!(_cap0 && _cap0.canUse());
  if (!BF.appState.currentBookId || _eng0 === 'none' || (_cap0 && _cap0.native && !_localOk0)) {
    /* 显式档（设置指定了某一档）引擎不可用：不静默换引擎，
       只报错 + 提供「临时改用」动作（显式档规则） */
    const _forced = BF.tts.forcedEngine();
    const _fc = _forced ? BF.tts.cap(_forced) : null;
    if (_fc && _fc.network) {
      const _act = BF.tts.stab.tempAction(_forced);
      BF.noti.warn('当前引擎「' + _fc.label + '」不可用（显式档不自动回落）' + (_act ? '，可' + _act.label : ''),
        _act ? { action: { label: _act.label, run: _act.run } } : undefined);
    } else {
      BF.noti.warn('当前环境不支持朗读（请检查设置→语音中的在线/离线引擎开关）');
    }
    return;
  }
  /* 语音前置校验：本机档且语音列表为空（getVoices().length===0，典型
     中文语音包缺失）时根本不进入播放状态，避免 utterance 空转。
     给出「改用在线引擎 / 复制文本」两个出口。 */
  if (_cap0 && _cap0.native && _localOk0) {
    try {
      const _vs = BF.tts.offline.voices && BF.tts.offline.voices();
      if (!_vs || !_vs.length) {
        BF.noti.warn('未检测到可用语音，请在系统设置中安装中文语音包', {
          action: { label: '改用在线引擎', run: function () { BF.settings.set('ttsEngine', 'auto'); BF.noti.info('已切换引擎策略为自动，请再次点朗读'); } },
        });
        return;
      }
    } catch (e) { BF.err.report('tts.voicecheck', e); }
  }
  const b = BF.reader.state.book;
  if (!b) return;
  BF.tts._setPhase('loading');
  BF.library.getChapterText(b, BF.appState.currentChapterIdx).then(function (text) {
    if (BF.tts.state._sess !== _mySess) return;   /* 过期 start：更新的 start 已接管，自弃 */
    if (!text || !text.trim()) {
      /* 空章不能静默 return：按下朗读毫无反应，用户只能反复点同一枚按钮。
         这里复位播放态 + 说明原因，并给出「跳到有正文的下一章」的出口。 */
      BF.tts.state.playing = false;
      BF.tts._setPhase('idle');
      BF.tts.setPlayIcon(false);
      const _bar = document.getElementById('tts-bar');
      if (_bar) _bar.classList.remove('show');
      BF.noti.warn('本章没有正文，无内容可朗读', {
        action: { label: '跳到下一章', run: function () { try { BF.tts.nextChapter(); } catch (e) { BF.err.report('tts.emptyChapter.next', e); } } },
      });
      return;
    }
    BF.tts.state.playing = true;
    BF.tts._setPhase('playing');
    BF.tts.state.bookId = BF.appState.currentBookId;
    BF.tts.state.chapterIdx = BF.appState.currentChapterIdx;
    BF.tts.state.startTime = Date.now();
    /* 睡眠定时：到点自动停止朗读 */
    const sm = BF.settings.num('ttsSleepMin', 0);
    if (sm > 0) {
      BF.tts._sleepT = BF.timers.timeout(function () { BF.noti.info('睡眠定时已到，停止朗读'); BF.tts.stop(); }, sm * 60000);
    }
    BF.tts.state.wordsRead = 0;
    BF.tts.state._errCount = 0;
    /* 单次播放重试预算 + 离线单飞守卫重置（每次点
       朗读重置；在线引擎续播/恢复经 resume→start→
       beginPlayback 同样重置——需用户操作，非漏洞；
       引擎切换/阶梯下探不重置——见 BF.tts.stab.handleFailure） */
    BF.tts.stab.beginPlayback();
    const sess = BF.store.lsGet(BF.store.K.TTS_SESSION, null);
    const sessFrom = (sess && sess.bookId === BF.appState.currentBookId && sess.chapterIdx === BF.appState.currentChapterIdx && typeof sess.offset === 'number' && sess.offset > 0) ? sess.offset : 0;
    const eng = BF.tts.pickEngine();
    BF.tts._setEngine(eng);
    const bar = document.getElementById('tts-bar');
    if (bar) bar.classList.add('show');
    /* 出现前刷一次底栏高度：窄屏底栏换行后朗读条要停在它上方，
       而不是按写死的 --bar-h 压在「上一章 / 下一章」上。 */
    if (BF.reader.syncBarAnchor) BF.reader.syncBarAnchor();
    BF.tts.setPlayIcon(true);
    BF.tts.updateVoiceLabel(eng);
    /* 整章朗读走索引化切句：把阅读区当前的段落数组交给 segment，
       让每句带上段落索引，BF.tts.highlight 才能按段定位。
       paras 取 BF.reader.state.paras（DOM 的 <p> 就是它），与 renderChapter
       渲染的是同一份；若阅读区没开/为空/段落跨度对不上，segment 会自行降级为
       未索引（返回字符串数组），此时高光走全文搜索兜底。
       切句结果只是多了 pi/po 两个定位字段，句本身不变。 */
    const segs = BF.tts.offline.segment(text, { indexed: true, paras: (BF.reader.state && BF.reader.state.paras) || [] });
    BF.tts.state.segs = segs;
    /* 按节压一次孤儿：这一节当前切出来的是这些句，上一轮切法留下的、
       这次不再出现的键就直接删掉（重分章 / 换分段粒度 / 改净化都会改变切句）。
       后台跑，不等它：压不成都不是朗读能不能用的事（Promise 内部已吞异常）。 */
    if (BF.tts.cache && BF.tts.cache._enabled && BF.tts.cache._enabled()) {
      (function (_segs, _eng) {
        Promise.resolve().then(function () {
          return BF.tts.cache.syncSectionFrom(_eng, BF.tts.state.bookId, BF.appState.currentChapterIdx,
            _segs.map(function (s) { return BF.tts.normalize((typeof s === 'string') ? s : ((s && s.text) || '')); }));
        }).catch(function (e) { BF.err.report('tts.cacheSync', e); });
      })(segs, eng);
    }
    /* 听读共锚（读的锚 → 听起点）：按下朗读要从「我正在读的位置」开口——
       取视口第一个可见段落所属的首句。恒从章首或断点句号起的话，读到一半点朗读
       会把读过的再念一遍，断点会话里的旧句号还会盖过当前的阅读位置。
       视口判不出（未索引化 segs / 不在阅读页 / 无可见段）才回落断点句号 → 章首。 */
    /* 起点优先级：调用方显式给的句号（续播 resume→start({from}))
       > 视口第一个可见段（全新开始，「我正在读这里」）> 会话断点 > 章首。
       续播时视口锚不能再插队，否则暂停后按播放会跳回视口顶部重念。 */
    let from = (opts && typeof opts.from === 'number') ? opts.from : BF.tts._visibleStartSeg(segs);
    if (from == null) from = sessFrom;
    BF.store.lsSet(BF.store.K.TTS_SESSION, { bookId: BF.tts.state.bookId, chapterIdx: BF.tts.state.chapterIdx, timestamp: Date.now(), offset: from });
    try { BF.tts.setMediaMeta(); } catch (e) { BF.err.report('tts.mediaMeta', e); }
    BF.tts.wakeLock();
    BF.tts.mediaSessionInit();
    const _c = BF.tts.cap(eng);
    if (_c && _c.native) _c.playNative(segs, from);
    else BF.tts.onlineSpeak(segs, from, eng);
  }).catch(function (_e) {
    /* .then 链必须带 catch：getChapterText 抛错时会变成 unhandled rejection，
       且播放态已置真却永不启动 → 朗读卡死。这里统一兜底：
       上报 + 可读错误（含下一步动作），并复位播放态。 */
    BF.err.report('tts.start', _e);
    BF.tts.state.playing = false;
    BF.tts._setPhase('error');
    BF.tts.setPlayIcon(false);
    const bar = document.getElementById('tts-bar');
    if (bar) bar.classList.remove('show');
    BF.feedback.fail('朗读启动失败', _e, {
      next: { label: '重试', run: function () { try { BF.tts.start(); } catch (e) { if (BF.err) BF.err.report('tts.start.retry', e); } } },
    });
  });
};

/* 浏览器代管播放的档：一句话直接喂 speechSynthesis（试听与单击朗读共用同一条）。
   cancel 之后同一拍接着 speak，Chromium 有概率直接吞掉这条（表现为「点了没声音」），
   所以统一隔一拍再说。 */
BF.tts._speakUtterance = function (text, tag) {
  const u = new SpeechSynthesisUtterance(text);
  const v = BF.tts.offline.voice(); if (v) u.voice = v;
  u.rate = BF.settings.num('ttsRate', 1);
  u.pitch = BF.settings.num('ttsPitch', 1);
  u.volume = BF.settings.num('ttsVolume', 0.9);
  BF.timers.timeout(function () { try { speechSynthesis.speak(u); } catch (e) { BF.err.report(tag || 'tts.tap', e); } }, 40);
};

/* 单击朗读：读一段（设置项 ttsTap 的消费点）。
   本机档直接 utterance；联网档走同一条 synthesize + AudioContext 通路 */
BF.tts.TAP_MAX = 500;   /* 临时试读的字数上限，两条引擎路径共用一个数 */
BF.tts.speakOnce = async function (text) {
  const t = String(text || '').trim();
  if (!t) return;
  const eng = BF.tts.pickEngine();
  if (eng === 'none') { BF.noti.warn('当前环境不支持朗读（请检查设置→语音中的在线/离线引擎开关）'); return; }
  try { BF.tts.offline.stop(); BF.tts._pfClear && BF.tts._pfClear(); } catch (e) {}
  /* 这里不调 BF.tts._clearSleep()：单击朗读只是临时试读，
     若跟着清掉，用户设定的「N 分钟后停止」就没了——设置里看着还开着，实际已经失效。
     睡眠定时只归停止朗读那条路径管。 */
  BF.tts.state.playing = false;   /* 单击朗读是临时试读，不接管整章播放态 */
  BF.tts.setPlayIcon(false);
  /* 单击朗读也要写 state.engine：不写则标识停在上一条播放路径的
     残留值（冷启动即 'offline'）。在引擎定下来的那一刻写标识。 */
  BF.tts._setEngine(eng);
  /* 超限不再静默截断：用户选中 800 字听前 500 字，得知道后 300 字没读 */
  const truncated = t.length > BF.tts.TAP_MAX;
  const say = BF.tts.normalize(truncated ? t.slice(0, BF.tts.TAP_MAX) : t);
  if (truncated) BF.noti.info('选区 ' + t.length + ' 字，本次只读前 ' + BF.tts.TAP_MAX + ' 字');
  const _cap = BF.tts.cap(eng);
  if (_cap && _cap.native) { BF.tts._speakUtterance(say, 'tts.tap'); return; }
  try {
    let ctx = BF.tts._audioCtx;
    if (!ctx) ctx = BF.tts._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    if (!_cap || !_cap.synth) throw BF.tts.stab.mkErr('F', (_cap && _cap.label || eng) + ' 不产音频字节，无法朗读', {});
    const blob = await _cap.synth(say);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = BF.settings.num('ttsVolume', 0.9);
    src.connect(gain); gain.connect(ctx.destination);
    /* 记下落地的音源：停止入口（_pfClear）会一起撤它，
       不记就只能等它自己放完——用户按了停止声音还在响。 */
    BF.tts._stopTap();
    BF.tts._tapSrc = src;
    src.onended = function () { if (BF.tts._tapSrc === src) BF.tts._tapSrc = null; };
    src.start();
  } catch (e) {
    BF.err.report('tts.tap:' + eng, e);
    BF.noti.warn('朗读失败，可尝试切换离线引擎');
  }
};

