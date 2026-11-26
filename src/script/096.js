/* ================= T8. 预合成缓存 ================= */
BF.tts._pf = new Map();
BF.tts._pfEpoch = 0;   /* 预合成会话代次：stop 时递增，旧代次的 blob 一律丢弃，避免极速暂停/续播串音 */
/* 单击试读的音源单独记一份：不记就停不下来——按停止、切章、再点别处，
   这条声音还在原地放（整章的停止路径管不到它）。 */
BF.tts._tapSrc = null;
BF.tts._stopTap = function () {
  const s = BF.tts._tapSrc; BF.tts._tapSrc = null;
  if (s) { try { s.onended = null; s.stop(); } catch (e) { BF.err.report('tts.stopTap', e); } }
};
/* 选区朗读用 <audio> 播整段：它是独立的音源，不登记就停不掉（按停止后声音照放） */
BF.tts._selAudio = null;
BF.tts._stopSel = function () {
  const a = BF.tts._selAudio; BF.tts._selAudio = null;
  if (a) {
    try { a.onended = null; a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { BF.err.report('tts.stopSel', e); }
    /* 主动停止时 onended 被摘掉了，blob URL 只能在这里收 */
    try { if (a.__bfUrl) URL.revokeObjectURL(a.__bfUrl); } catch (e2) {}
  }
};
BF.tts._pfClear = function () {
  BF.tts._pf.clear(); BF.tts._pfEpoch++;
  BF.tts._stopTap();
  BF.tts._stopSel();
    /* 长连接档自己负责撤在途请求：这里只问表，不认名字。
       不撤就会在用户暂停后继续把整章句子发往服务端。 */
    for (const k in BF.tts.CAPS) {
      const c = BF.tts.CAPS[k];
      if (c.cancelPending) { try { c.cancelPending(); } catch (e) {} }
    }
};
BF.tts._pfGet = function (i) {
  if (!BF.tts._pf.has(i)) return undefined;
  const v = BF.tts._pf.get(i);
  /* 读一次就置到队尾：淘汰看的是「多久没用过」，不是写入顺序 */
  BF.tts._pf.delete(i); BF.tts._pf.set(i, v);
  return v;
};
BF.tts._pfHas = function (i) { return BF.tts._pf.has(i); };
BF.tts._pfSet = function (i, blob) {
  /* 只留最近 8 句：按「最久没被用到」淘汰（命中后重新置到队尾），
     不是按写入顺序淘汰 —— 断点续播与预取会回头取用刚播过的句子。 */
  if (BF.tts._pf.has(i)) BF.tts._pf.delete(i);
  while (BF.tts._pf.size >= 8) { const oldest = BF.tts._pf.keys().next().value; if (oldest === undefined) break; BF.tts._pf.delete(oldest); }
  BF.tts._pf.set(i, blob);
};
/* 播放推进时的显式回收：minKeep 之前的句块直接丢，不看 LRU 顺序。
   LRU 兜总量，这里兜「往后翻页后旧句仍驻留」的尾巴。 */
BF.tts._pfEvict = function (minKeep) {
  if (!BF.tts._pf.size) return;
  for (const k of Array.from(BF.tts._pf.keys())) { if (k < minKeep) BF.tts._pf.delete(k); }
};
BF.tts._pfQueue = async function (idx, seg, eng) {
  if (BF.tts._pf.has(idx)) return;
  const key = eng + ' ' + seg;
  if (BF.tts._pfInFlight && BF.tts._pfInFlight[key]) return;   /* 在途去重：同一句正在合成就不重复发 */
  if (!BF.tts._pfInFlight) BF.tts._pfInFlight = {};
  const epoch = BF.tts._pfEpoch;
  const p = (async function () {
    /* 预合成与主循环走同一个 synth 入口：两处各抄一遍引擎名，
       换引擎时最容易漏的就是这条后台路径（它失败了不出声，只是不省请求）。 */
    const cap = BF.tts.cap(eng);
    if (!cap || !cap.synth) throw new Error('无可用合成入口：' + eng);
    return await cap.synth(seg);
  })();
  BF.tts._pfInFlight[key] = p;
  try {
    const blob = await p;
    if (epoch !== BF.tts._pfEpoch) return;   /* 会话已切换，丢弃过期 blob */
    BF.tts._pfSet(idx, blob);
    return blob;
  } catch (e) { /* 预合成失败不影响主流程 */ }
  finally { if (BF.tts._pfInFlight[key] === p) delete BF.tts._pfInFlight[key]; }
};

