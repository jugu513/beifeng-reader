/* ================= T7. 在线引擎播放 ================= */
BF.tts.onlineSpeak = async function (segs, from, eng, _carryBudget) {
  const tts = BF.tts;
  const stab = BF.tts.stab;
  const _sess0 = tts.state._sess;   /* 会话代次：旧循环不得越过新 start 继续 */
  /* 本函数是引擎真正生效的地方（每句都真按 eng 合成），标识必须在这里写：
     不写则直接调它时 state.engine 停在初值 'offline'，顶栏圆点与
     设置面板按离线着色，用户看到「明明 Edge 在出声却显示浏览器语音」。
     阶梯下探时 handleFailure 会带着新引擎重入本函数（第 4 参 _carryBudget），
     所以这一行同时覆盖了「每次换引擎都要更新标识」。 */
  tts._setEngine(eng);
  /* 重试预算按「单次播放」计——start 新点朗读才重置；
     引擎切换（阶梯下探，第 4 参 _carryBudget=true）不重置，不无限重试 */
  if (!_carryBudget) stab.beginPlayback();
  /* 心跳：在线引擎每句一次完整合成/连接即心跳信号（edge 每句新连接） */
  stab.watchdogStart();
  let audioCtx = tts._audioCtx;
  if (!audioCtx) {
    try { audioCtx = tts._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { BF.noti.error('无法创建音频上下文'); tts.stop(); return; }
  }
  if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
  /* 这一档能不能给时间轴、缓存键怎么算，都问能力表：
     原来这里两处写死 edge/mimo 的名字，加一档就要回头改播放循环 */
  const cap = BF.tts.cap(eng);
  let pos = from || 0;
  const play = async function () {
    /* 会话代次对不上 = 已有更新的 start 接管，本循环立即退场（防双声/串句） */
    if (tts.state._sess !== _sess0) return;
    /* 用户已停止时不再继续播放（在线引擎同样受停止意图约束） */
    if (tts.state._stopIntent) { tts.stop(); return; }
    if (!tts.state.playing) return;
    if (pos >= segs.length) { tts.segEnd(); return; }
    /* 句可能是 {text,pi,po}（索引化），合成/统计/预合成一律用句文本，
       定位字段只给 highlight 用。segs 数组本身（含 pos 索引）不变，
       故 _pfGet/_pfSet/_pfQueue 的 pos 键与断点续播的 offset 语义不变。 */
    const seg = segs[pos];
    const segTxt = (typeof seg === 'string') ? seg : ((seg && seg.text) || '');
    const speakTxt = BF.tts.normalize(segTxt);   /* 合成读规范化后的文本，统计与定位仍按原句 */
    tts.highlight(segs, pos);
    stab.watchdogFeed();   /* 每句开始 = 一次心跳 */
    try {
      let blob = tts._pfGet && tts._pfGet(pos);
      let hitTl = null;
      /* 本会话内存预取没命中就看跨会话缓存（默认关，隐私模式不读）；命中即零请求 */
      if (!blob && tts.cache) {
        const _h = await tts.cache.get(eng, speakTxt);
        if (_h && _h.blob) { blob = _h.blob; hitTl = _h.tl || null; }
      }
      /* 在途去重：本句正在被预取合成（同一引擎 + 同一文本），等它的结果，不再向服务端发第二次 */
      if (!blob && tts._pfInFlight) {
        const _key = eng + ' ' + speakTxt;
        if (tts._pfInFlight[_key]) { try { blob = await tts._pfInFlight[_key]; } catch (e2) { blob = null; } }
      }
      /* 上面两个 await 期间用户可能已停止或切了会话：此时不能再发一次整句合成
         （MiMo 没有 abort 通路，发出去就收不回）。 */
      if (tts.state._stopIntent || tts.state._sess !== _sess0) return;
      if (!blob) {
        /* 分类退避 + 预算硬顶 + 引擎级去抖：
           归一点在 throw 处打标（err.code），此处只做两分支 */
        blob = await stab.synthesizeWithRetry(speakTxt, eng);
        tts._pfSet && tts._pfSet(pos, blob);
        /* 进缓存时把这一句的边界一起存：只有真从服务端拿到过边界才存，
           没有边界不等于「没有边界可存」——所以命中时按命中那份走。 */
        if (tts.cache && blob) tts.cache.put(eng, speakTxt, blob, (cap && cap.timelineFor) ? cap.timelineFor(speakTxt) : null);
      }
      if (tts.state._sess !== _sess0 || !tts.state.playing) return;
      const buf = await audioCtx.decodeAudioData(await blob.arrayBuffer());
      if (tts.state._sess !== _sess0 || !tts.state.playing) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const gain = audioCtx.createGain();
      gain.gain.value = BF.settings.num('ttsVolume', 0.9);
      src.connect(gain); gain.connect(audioCtx.destination);
      src.onended = function () {
        tts.state._src = null;   /* 这一句的音源已经结束，真暂停不再认它 */
        BF.tts._stopTimeline();
        /* 停止意图在 onended 同样拦截，防止自动重启 */
        if (tts.state._stopIntent) return;
        /* 整句播完仍无 boundary → 该引擎不提供逐词进度。
           首次出现时提示一次（会话内不重复），把「逐词高亮默认开却不生效」
           这个静默落差变成用户可见的事实。 */
        if (BF.settings.get('ttsWordHighlight') !== false && !tts.state._boundarySeg) {
          BF.tts._noteNoBoundary(cap ? cap.label : eng);
        }
        tts.state.pos = pos + 1;
        tts.state.wordsRead += segTxt.length;
        try { if (BF.tts.health) BF.tts.health.notePlayOk(); } catch (e4) {}
        tts._saveSession();   /* 在线引擎同样回写句号 */
        tts.updateStats();
        stab.watchdogFeed();   /* 每句播完 = 一次心跳 */
        pos++;
        play();
      };
      src.start();
      /* 在线引擎：服务端回传了词边界就按它推进逐词层；没回就维持整句底色，不降级。
         离线引擎走的是 Web Speech 的 boundary 事件，不经过这里。 */
      try {
        /* 命中缓存的句子用缓存里那份边界（这一句没再发请求，服务端也就没有新边界可给）；
           现合成的句子按能力表要一份当前文本的边界。两条都不给就维持整句底色。 */
        const _tl = hitTl || (cap && cap.timeline() ? cap.timelineFor(speakTxt) : null);
        if (_tl) BF.tts._driveTimeline(seg, speakTxt, _tl);
      } catch (e5) {}
      /* 真暂停的抓手：记下当前音源，句播完即清空 */
      tts.state._src = src;
      /* 音源自身失败（解码后仍播不出、上下文被系统等）不会进上面的 catch：
         没有 onerror 就是「界面显示播放中、实际静音」的静默断链。
         走同一条失败总入口，记账与阶梯回落保持一致。 */
      src.onerror = function (ev) {
        stab.handleFailure(eng, (ev && ev.message) ? new Error(ev.message) : new Error('音频播放失败（音源已中断）'), { segs: segs, pos: pos });
      };
      if (pos + 1 < segs.length && !(tts._pfHas && tts._pfHas(pos + 1))) {
        const nxt = segs[pos + 1];
        tts._pfQueue && tts._pfQueue(pos + 1, BF.tts.normalize((typeof nxt === 'string') ? nxt : ((nxt && nxt.text) || '')), eng);
      }
      /* 第二句预取：语速快或短句多时，只预一句会在句间露出一截合成延迟。
         预取请求与当前句并发（Edge 侧有握手去重与队列串行），失败静默。 */
      if (pos + 2 < segs.length && !(tts._pfHas && tts._pfHas(pos + 2))) {
        const nx2 = segs[pos + 2];
        tts._pfQueue && tts._pfQueue(pos + 2, BF.tts.normalize((typeof nx2 === 'string') ? nx2 : ((nx2 && nx2.text) || '')), eng);
      }
      /* 落后回收：断点续播与回退重读会往前翻，LRU 容量兜底之外，
         播放推进到 pos 时把 3 句之前的合成块明确丢掉，内存峰值不随章长涨。 */
      if (tts._pfEvict) tts._pfEvict(pos - 3);
    } catch (e) {
      /* 用户按了停止/切了章：请求是被我们主动撤掉的，不是失败——
         走失败入口会记黑表、弹通知、甚至降级换引擎。 */
      if (e && e.__bfCancelled) return;
      BF.err.report('tts.online:' + eng, e);
      /* 失败总入口：分类记账（黑表 TTL/去抖/预算）→ 自动档走四级
         阶梯 edge→mimo→offline→none（修跳档回落），显式档报错不换引擎 */
      stab.handleFailure(eng, e, { segs: segs, pos: pos });
    }
  };
  play();
};

