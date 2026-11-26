/* ================= T3. MiMo 引擎 ================= */
BF.tts.mimo = (function () {
  const BASE = 'https://api.xiaomimimo.com/v1/chat/completions';
  const MODEL = 'mimo-v2.5-tts';
  /* 音色表：id 必须逐字等于服务端真实 ID，否则 audio.voice 一传就 400。
     取自服务端 400 报错原文「Available voices:
     [mimo_default, 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe, Milo, Dean]」（2026-10-11 核实）。
     mimo_default 保留英文（服务端确实这么叫）；其余为中文/英文原样。
     旧的 8 个拼音 ID（bingtang/moli/qingchen/…）服务端一个都不认，已整表作废：
     用户 2026-10-11 决定「只留对得上的」，故此处不留占位、不做兼容映射。 */
  const VOICES = [
    { id: 'mimo_default', display: '默认' },
    { id: '冰糖', display: '冰糖（女声·甜）' },
    { id: '茉莉', display: '茉莉（女声·清亮）' },
    { id: '苏打', display: '苏打（男声·活泼）' },
    { id: '白桦', display: '白桦（男声·沉稳）' },
    { id: 'Mia', display: 'Mia（女声·海外）' },
    { id: 'Chloe', display: 'Chloe（女声·海外）' },
    { id: 'Milo', display: 'Milo（男声·海外）' },
    { id: 'Dean', display: 'Dean（男声·海外）' },
  ];
  const VOICE_IDS = VOICES.map(function (v) { return v.id; });
  /* 服务端唯一已知音色集合：voiceId() 读到的值若不在此表内（含旧拼音 ID 与
     用户手改过的历史值），一律回落 mimo_default，避免必然触发的 400。 */
  function sanitizeVoice(v) {
    const s = String(v == null ? '' : v).trim();
    return VOICE_IDS.indexOf(s) >= 0 ? s : 'mimo_default';
  }
  function key() { return BF.settings.get('mimoApiKey') || ''; }
  function enabled() {
    /* 在线引擎需联网，离线时不可用（走离线/无朗读降级） */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return !!key();
  }
  function voiceId() { return sanitizeVoice(BF.settings.get('ttsMimoVoice')); }
  function format() { return BF.settings.get('ttsMimoFormat') === 'mp3' ? 'mp3' : 'wav'; }
  /* 待朗读文本上限（字符）。服务端并无 500 字硬限制（504 字能正常合成 188.8s 音频），
     上限是为成本与超时设的：单次成本随字数陡增（500 字约 1,650–2,276 tokens，短句 124–150），
     超时预算也按字数分级；超长文本分句后再送。 */
  const TEXT_CAP = 500;
  /* 超时按字数分级：8 字≈2s，504 字合成远超 30s（返回 188.8s 音频），
     固定 30s 时，长文本必然超时。下限 30s 保证短句路径不变；每字 900ms，1500 字封顶。 */
  const TMO_BASE_MS = 30000, TMO_PER_CHAR_MS = 900, TMO_MAX_MS = 1500000;
  function timeoutMs(text) {
    const n = String(text == null ? '' : text).length;
    return Math.min(TMO_MAX_MS, TMO_BASE_MS + n * TMO_PER_CHAR_MS);
  }
  /* MIME 按实际返回的容器头嗅探，不信任请求参数：服务端在参数层级不匹配时
     会返回与请求不同的容器（照 fmt 贴 audio/mpeg 却拿到 WAV 字节，
     只能靠魔数解码）。RIFF→wav，ID3/MP3 帧同步字→mpeg，
     其余按 fmt 兜底。 */
  function sniffMime(bytes, fmt) {
    const fallback = fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    if (!bytes || bytes.length < 3) return fallback;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';   /* RIFF */
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';                        /* ID3 */
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';                                   /* MP3 帧同步字 */
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'audio/wav';  /* ...WAVE 标记 */
    return fallback;
  }
  async function synthesize(text, voice, fmt) {
    const k = key();
    if (!k) throw BF.tts.stab.mkErr('B', '未配置 MiMo 密钥（设置→语音填写）');
    const _raw = String(text == null ? '' : text);
    const spoken = _raw.slice(0, TEXT_CAP);
    /* 超长句静默切尾会少念一截：至少留一条日志，与单击朗读的「只读前 500 字」口径一致 */
    if (_raw.length > TEXT_CAP) BF.log && BF.log.warn('MiMo 单句超长：已截到 ' + TEXT_CAP + ' 字（原 ' + _raw.length + ' 字）');
    const v = sanitizeVoice(voice || voiceId());
    const f = (fmt || format()) === 'mp3' ? 'mp3' : 'wav';
    const ctrl = new AbortController();
    const tmo = timeoutMs(spoken);
    const timer = BF.timers.timeout(function () { ctrl.abort(); }, tmo);
    try {
      let res;
      try {
        res = await fetch(BASE, {
          method: 'POST',
          headers: { 'api-key': k, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            /* 文本必须放在 assistant 角色里。
               user=文本 / assistant='' 虽满足「有 assistant 角色」但角色放反——
               服务端据此不朗读，一直返回 0.8–0.96s 固定占位音频
               （24 字文本仅 8 completion_tokens）。
               同一句 24 字：user=文本/assistant='' → 0.96s、8 tokens；
               user=''/assistant=文本 → 4.96s、33 tokens。assistant 角色不可省，
               故 user 保留为一句朗读指令。 */
            messages: [
              { role: 'user', content: '请朗读以下内容' },
              { role: 'assistant', content: spoken },
            ],
            /* voice / format 必须放进 audio 对象。顶层 voice 与
               response_format 被服务端完全忽略——顶层 voice='nonexistent_voice_xyz'
               仍 200 返回（连校验都没有），audio.voice 传错才 400 并附可用音色列表。 */
            audio: { voice: v, format: f },
          }),
          signal: ctrl.signal,
        });
      } catch (netErr) {
        /* 网络层：离线判 A（T4 不进 online），其余瞬时抖动判 D（T1 退避重试） */
        const why = (netErr && netErr.name === 'AbortError')
          ? 'MiMo 请求超时（' + Math.round(tmo / 1000) + 's）'
          : 'MiMo 网络错误：' + ((netErr && netErr.message) || 'fetch failed');
        throw BF.tts.stab.mkErr(BF.tts.stab.offlineNow() ? 'A' : 'D', why);
      }
      if (!res.ok) {
        /* err.raw 白名单：只存状态码与 retry-after，不存请求头（api-key 头在上方） */
        const st = res.status;
        const ra = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
        if (st === 401 || st === 403) throw BF.tts.stab.mkErr('B', 'MiMo HTTP ' + st + '（凭据无效或过期）', { status: st });
        if (st === 429 || st >= 500) throw BF.tts.stab.mkErr('E', 'MiMo HTTP ' + st + '（限流或服务繁忙）', { status: st, retryAfter: ra });
        throw BF.tts.stab.mkErr('C', 'MiMo HTTP ' + st + '（协议或请求变更）', { status: st });
      }
      const j = await res.json();
      const b64 = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.audio && j.choices[0].message.audio.data;
      if (!b64) throw BF.tts.stab.mkErr('C', 'MiMo 响应无音频（协议变更）');
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return new Blob([arr], { type: sniffMime(arr, f) });
    } finally {
      timer();
    }
  }
  return { VOICES, key, enabled, voiceId, format, synthesize, sanitizeVoice, sniffMime, timeoutMs };
})();

