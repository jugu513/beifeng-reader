/* ================= T9. 控制 ================= */
/* 把当前朗读句号回写进 TTS_SESSION，使「断点续播」真的能从暂停处继续 */
BF.tts._saveSession = function () {
  /* 每句 onended 都同步 stringify+localStorage 写，长章就是高频存储抖动，
     所以走 500ms 防抖置脏；pause/stop/切章等退出路径走 _saveSessionFlush 立刻落最新句号。
     防抖定时器一律走 BF.timers.timeout（返回取消函数，flush 里直接调用取消），
     不用裸 setTimeout/clearTimeout。 */
  BF.tts._sessDirty = true;
  if (BF.tts._sessT) return;
  BF.tts._sessT = BF.timers.timeout(function () {
    BF.tts._sessT = null;
    if (BF.tts._sessDirty) { BF.tts._sessDirty = false; BF.tts._saveSessionNow(); }
  }, 500);
};
BF.tts._saveSessionNow = function () {
  try {
    /* 断点必须写朗读自己的 state.bookId/chapterIdx（start 时钉住），
       不能写 BF.appState —— 朗读中切书后 appState 已指向新书，
       旧书的逐句断点会连书带章写进新书，续播直接跳到乱码位置。 */
    BF.store.lsSet(BF.store.K.TTS_SESSION, {
      bookId: BF.tts.state.bookId, chapterIdx: BF.tts.state.chapterIdx,
      timestamp: Date.now(), offset: BF.tts.state.pos,
    });
  } catch (e) { BF.err.report('tts.session.save', e); }
};
BF.tts._saveSessionFlush = function () {
  /* _sessT 现在是 BF.timers.timeout 的取消函数（不是句柄 id） */
  if (BF.tts._sessT) { BF.tts._sessT(); BF.tts._sessT = null; }
  if (BF.tts._sessDirty) { BF.tts._sessDirty = false; BF.tts._saveSessionNow(); }
};
BF.tts.pause = function () {
  /* 本机档分支同样要改 state.playing，否则 resume 的 if(!playing) 恒不成立，暂停后再按播放毫无反应 */
  /* 暂停/停止是明确的时间点边界，落盘不再走防抖 */
  const _cap = BF.tts.cap(BF.tts.state.engine);
  if (_cap && _cap.native) { _cap.pauseNative(); BF.tts.state.playing = false; BF.tts._saveSessionFlush(); }
  else {
    /* 联网引擎的真暂停：把 AudioContext 冻住（suspend），当前句停在中断的字上，
       再按播放就从这里继续。只置 playing=false 的话当前这句照样播完——
       界面显示「已暂停」，耳朵里还在念，就是「按钮不听话」。 */
    const ctx = BF.tts._audioCtx;
    const cur = BF.tts.state._src;
    if (ctx && cur && ctx.state === 'running') {
      try { ctx.suspend(); BF.tts.state._ctxPaused = true; } catch (e) { BF.err.report('tts.pause.ctx', e); }
    }
    BF.tts._pfClear();
    BF.tts.state.playing = false; BF.tts._saveSessionFlush();
  }
  BF.tts.setPlayIcon(false);
  BF.tts._setPhase('paused');
};
BF.tts.resume = function () {
  if (!BF.tts.state.playing) {
    const _cap = BF.tts.cap(BF.tts.state.engine);
    if (_cap && _cap.native) {
      /* resume 只对「真暂停」有意义。stop 之后 speechSynthesis
         队列已空，再调 resume() 是空操作 —— 图标显示「播放中」却永远无声，
         必须再点一次停止才解。判 paused && speaking：两者皆真才是可解冻的
         真暂停；否则清掉旧队列，落到下方 start({from:pos}) 从会话句号起播。 */
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.paused && speechSynthesis.speaking) {
        _cap.resumeNative();
        /* 本机档分支必须置 playing：不改则 toggle 恒走 resume、
           暂停后再也暂停不了，自动翻章/后台状态/切章续读全部连锁失效。
           此处置 playing = true，让状态与真实语音动作对齐。 */
        BF.tts.state.playing = true;
        BF.tts._setPhase('playing');
        BF.tts.setPlayIcon(true);
        return;
      }
      try { speechSynthesis.cancel(); } catch (e) {}
    }
    /* 真暂停可续时先解冻 AudioContext：从停下那个字继续，
       不重新合成、不跳句、也不回到「视口首段」重新取起点。 */
    const ctx = BF.tts._audioCtx;
    if (BF.tts.state._ctxPaused && ctx && BF.tts.state._src) {
      BF.tts.state._ctxPaused = false;
      BF.tts.state.playing = true;
      BF.tts._setPhase('playing');
      try { ctx.resume(); } catch (e) { BF.err.report('tts.resume.ctx', e); }
      BF.tts.setPlayIcon(true);
      return;
    }
    BF.tts.state._ctxPaused = false;
    BF.tts.state.playing = true;
    /* 恢复走会话句号，不再让「视口第一个可见段」盖掉刚写入的句号：
       视口锚是给全新开始用的，续播的起点是 state.pos。 */
    BF.tts.start({ from: BF.tts.state.pos || 0 });
  }
};
BF.tts.toggle = function () {
  if (BF.tts.state.playing) BF.tts.pause();
  else BF.tts.resume();
};
BF.tts.stop = function (opts) {
  BF.tts._saveSessionFlush();   /* 停止边界立刻回写句号（防抖窗口内停的也算） */
  BF.tts._clearSleep();
  BF.tts.stab.watchdogStop();   /* 心跳监测随播放停止 */
  BF.tts.stab.clearTemp();      /* 临时改用（内存态）随播放停止失效，设置本身未改 */
  BF.tts.state.playing = false;
  /* 停止意图标志。置位后 onend/onerror/Worker 回调等一切
     可能重启播放的路径都会在入口被挡住，杜绝「停了又被自动拉起」。
     只有用户显式调用 start 才清除。 */
  BF.tts.state._stopIntent = true;
  /* 只有「自动切章自己发的那一次 stop」保留续播令牌；用户停止一律作废，
     等待翻章期间的这一停就不会被当成自动续播再拉起来。 */
  if (!(opts && opts.autoNext)) BF.tts.state._autoTok = null;
  BF.tts.state._idleStart = null;
  BF.tts.state._idleCount = 0;
  if (BF.tts.state._autoNextT) { BF.tts.state._autoNextT(); BF.tts.state._autoNextT = null; }
  BF.tts.state._autoNext = false;
  BF.tts._pfClear();
  BF.tts.offline.stop();
  /* 停止不是暂停：先撤正在放的音源，再清抓手。
     顺序反过来（先把 _src 置 null 再判）那个 if 永远不成立，
     点了停止声音还在放。 */
  const _stopSrc = BF.tts.state._src;
  BF.tts.state._src = null;
  BF.tts.state._ctxPaused = false;
  if (_stopSrc) { try { _stopSrc.stop(); } catch (e) {} try { _stopSrc.disconnect(); } catch (e) {} }
  if (BF.tts._audioCtx) { try { BF.tts._audioCtx.suspend(); } catch (e) {} }
  BF.tts.wakeLockRelease();
  try { BF.tts.mediaSessionTeardown(); } catch (e) {}
  const bar = document.getElementById('tts-bar');
  /* 停止时是否隐藏面板要读 ttsHideOnStop，不读则这个设置项永远无效 */
  if (bar && BF.settings.get('ttsHideOnStop') !== false) bar.classList.remove('show');
  BF.tts.setPlayIcon(false);
  BF.tts.hideHighlight();
  BF.tts._setPhase('idle');
  BF.tts.syncStatusLabel();   /* 停止时清掉书架顶栏的「朗读中」 */
};
BF.tts.segEnd = function () {
  BF.tts.stab.watchdogStop();   /* 章末解除心跳监测（自动下一章的 start→speak 会重新武装） */
  if (BF.settings.get('ttsAutoNext')) {
    if (BF.tts.state._autoNext) return;
    BF.tts.state._autoNext = true;
    BF.tts.state._autoNextT = BF.timers.timeout(function () {
      BF.tts.state._autoNext = false;
      BF.tts.state._autoNextT = null;
      const b = BF.reader.state.book;
      const cur = BF.appState.currentChapterIdx;
      if (b && cur >= (b.totalChapters || 1) - 1) { BF.tts.stop(); return; }   /* 最后一章：停住不越界 */
      /* T8：显式跳到下一章并等承诺落地后再起播；不再依赖 playing 的轮询
         （gotoChapter 会先停朗读，旧轮询首行 !playing 直接退出，导致章末不续读）。
         页码模式下 nextChapter 只翻页不换章，这里统一用 gotoChapter 确保真正进下一章。 */
      /* 章末续读要跨过 gotoChapter 自己发的那次 stop：先挂令牌再切章，
         切章动作用 autoNext 让 stop 保留令牌；回来时令牌还在才起播。
         等待期间用户按停止或改点别的章，令牌都会被清掉，这里直接放弃。 */
      const _tok = {};
      BF.tts.state._autoTok = _tok;
      Promise.resolve(BF.reader.gotoChapter(cur + 1, { autoNext: true })).then(function () {
        if (BF.tts.state._autoTok !== _tok) return;
        BF.tts.state._autoTok = null;
        BF.tts.start();
      });
    }, 300);
  } else {
    BF.tts.stop();
  }
};
BF.tts.prevChapter = function () {
  const _wasPlaying = BF.tts.state.playing;
  /* 滚动模式的切章会经 gotoChapter 把播放中的朗读先停掉（防旧章语音压新章画面），
     页码模式直接换页、不经过 gotoChapter。所以只在「确实被停了」时重新起播：
     还在播的会话（页码模式）绝不能再 start —— 那会重启整章、丢掉当前句位。
     等切章承诺落地再判，避免与 loadChapter 竞争（高亮按旧 paras 定位）。 */
  Promise.resolve(BF.reader.prevChapter()).then(function () {
    if (_wasPlaying && !BF.tts.state.playing) BF.tts.start();
  });
};
BF.tts.nextChapter = function () {
  const _wasPlaying = BF.tts.state.playing;
  Promise.resolve(BF.reader.nextChapter()).then(function () {
    if (_wasPlaying && !BF.tts.state.playing) BF.tts.start();
  });
};
BF.tts.resumeTTS = function () {
  const s = BF.store.lsGet(BF.store.K.TTS_SESSION, null);
  if (s && s.bookId) {
    BF.app.openBook(s.bookId);
    BF.timers.safeTimeout(function () {
      BF.reader.gotoChapter(s.chapterIdx);
      /* 带 offset：不带的话 start 用「视口首句」算起点，刚跳章视口在章首，续播从章首重念 */
      BF.tts.start({ from: (typeof s.offset === 'number' && s.offset >= 0) ? s.offset : 0 });
    }, 500, 'resumeTTS');
  }
};

