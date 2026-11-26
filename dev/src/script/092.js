/* ================= 17.0 引擎能力自述表（唯一一份） =================
   播放层原来按引擎名分支：加一个引擎要回头改退避阶梯、可用性、健康灯、试听、
   缓存键、时间轴判定、状态点色、暂停恢复六处以上。这张表把「这一档能做什么」收进一行：
     canUse      本机此刻能不能用（不含黑表/去抖——那两个是策略，不是能力）
     synth       一句文本怎么变成音频；native 档没有（它走 speechSynthesis，不产字节）
     network     有没有出站网络口：决定黑表/去抖/探针约不约束它，也决定状态点色
     native      播放是否由浏览器代管（pause / resume / stop 走另一套）
     timeline    这一档能不能给服务端词/句边界（要看设置就自己读，别让调用方猜引擎名）
     timelineFor 取该句已登记的时间轴（没有就给 null，调用方维持整句底色）
     cacheKeyOf  这一档「当前用的是什么声音」的签名，进跨会话缓存的键；
                 null = 这一档不进缓存。改音色/语速后签名必须跟着变。
     localOnly   只在浏览器本机的某个环境里可用（设置与文案要说清，别让 UI 撒谎）
     setting     设置里「引擎策略」下拉用的值名。Edge 那档历史值是 online，
                 与档位名不同名；这层映射原来散在六处三目表达式里，现在写进表，
                 加一档联网引擎不必回头找那些 `t === 'online' ? 'edge' : …`。
     localState  不联网就能得到的健康结论（本机档用）；给了它，探针不必 force
     unconfigured 是「没配好」而不是「坏了」的判据（如密钥没填），三态灯单列一档
     probe       真出一次门的自测，返回 {ok, reason?}；只在调用方 force 时才跑
     cancelPending 有长连接的档：把在途的预取/合成请求一起撤掉（暂停与切会话时用）
     voiceName   朗读条上「档位 · 音色」里的音色名；不给就没有后半段
     cfgTitle/cfgRows/cfgKeys
                 这一档在「设置→语音」里独占的那几行（标题、行、涉及的设置键）。
                 面板按当前策略只画用得着的那一档：选了 MiMo 就不该再看到 Edge 的 Token。
   加引擎＝在这里加一行 + 提供那个模块；下面所有读点只认表，不再认名字。
   表里一律放函数：定义这一刻 BF.tts.edge / mimo / offline 还没挂上来，读得晚才安全。 */
BF.tts.CAPS = {
  edge: {
    id: 'edge', label: 'Edge', setting: 'online', network: true, native: false, localOnly: true,
    canUse: function () { return BF.tts.edge.canUse(); },
    synth: function (t) { return BF.tts.edge.synthesize(t); },
    probe: function () {
      return BF.tts.edge.probeConnect ? BF.tts.edge.probeConnect()
        : Promise.resolve({ ok: false, reason: '本档没有握手探针，只能报本地事实' });
    },
    /* 有长连接的档自己负责撤在途请求（预取 + 当前句），否则暂停后仍会继续发 */
    cancelPending: function () { if (BF.tts.edge && BF.tts.edge.cancelAll) BF.tts.edge.cancelAll(); },
    /* 失败引导：凭据类（401/403）与「音色不被支持」两类文案原来散在 failNotify 的 if 链里，
       混进 B「凭据过期」会让用户去换 Token 白忙。每档自己说清根因与出口在哪。 */
    guideB: '。根因推测：微软升级了协议（Sec-MS-GEC 令牌算法或版本变化）——构造逐位正确也会被 403，优先怀疑协议而不是凭据，反复换 Token 无效。可临时改用浏览器语音；若你刚改过「Edge 凭据 Token」，先恢复为空再试一次。',
    guideBAct: { label: '去设置填 Edge Token', set: 'edgeToken' },
    guideF: '。服务端不认这个音色（不是凭据问题，换 Token 没用）。可到「设置→语音→Edge 音色」换一个服务端支持的音色后重试，或临时改用浏览器语音。',
    /* F 类有两种根因：音色不被支持（配置问题，能自助）与「本浏览器不是 Edge」
       （环境问题，换音色没用）。靠文案里的词区分，所以判据也放在表里。 */
    guideFWhen: /音色/,
    guideFAct: { label: '去设置换音色', set: 'ttsEdgeVoice' },
    /* 这一档在「设置→语音」里独占的行。原来它们和别的引擎混在一个
       「凭据与音色」分组里，选了 MiMo 也照样看得见 Edge 的 Token 与音色，
       整屏 34 行读不到重点。分组、显隐、顺序都只问这张表，面板不再认名字。 */
    cfgTitle: 'Edge 在线语音',
    cfgKeys: ['ttsEdgeVoice', 'edgeToken', 'edgeSecVer', 'ttsSentenceBoundary'],
    cfgRows: function () {
      return '' +
        BF.settingsUI._row('Edge 音色', '<select class="select" data-set="ttsEdgeVoice" style="flex:1">' +
          BF.tts.edge.VOICES.map(function (v) {
            return '<option value="' + v.id + '"' + (BF.settings.get('ttsEdgeVoice') === v.id ? ' selected' : '') + '>' + v.display + '</option>';
          }).join('') + '</select>') +
        BF.settingsUI._row('Edge 凭据 Token', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('edgeToken') || '') + '" class="input" data-set-text="edgeToken" id="set-edgeToken" style="flex:1" placeholder="留空用内置公开 Token；微软换要求时把新值填这里"/>') +
        BF.settingsUI._row('校验 Token', '<button class="btn btn-xs" data-edge-token-probe>测一次握手</button><span class="pane-hint" id="edge-token-probe-out"></span>') +
        BF.settingsUI._row('Edge 版本号', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('edgeSecVer') || '') + '" class="input" data-set-text="edgeSecVer" style="flex:1" placeholder="留空用内置 2-143.0.3650.75；Token 对但一直 403 时可填浏览器真实版本"/>') +
        /* 服务端时间轴是 Edge 一档的能力（MiMo 与浏览器语音不回词边界），
           所以这一行跟着 Edge 走，不放在通用「朗读节奏」里承诺做不到的事。 */
        BF.settingsUI._row('按服务端时间轴高亮', BF.settingsUI._sel('ttsSentenceBoundary', [['false', '关闭（默认）'], ['true', '开启（逐词跟随服务端边界）']])) +
        '<div class="pane-hint">Edge 语音只能在本机的 Edge 浏览器里用；在 Chrome / Firefox 下这一档不可用，会自动落到浏览器语音。选它朗读＝把当前正文发给微软；不想外发就把引擎策略设成「浏览器语音」。</div>';
    },
    timeline: function () { return !!BF.settings.get('ttsSentenceBoundary'); },
    timelineFor: function (t) { return (BF.tts.edge.timelineFor && BF.tts.edge.timelineFor(t)) || null; },
    voiceName: function () {
      const l = BF.tts.edge && BF.tts.edge.VOICES
        ? BF.tts.edge.VOICES.find(function (x) { return x.id === BF.settings.get('ttsEdgeVoice'); }) : null;
      return (l && l.display) || '默认';
    },
    cacheKeyOf: function () {
      /* 音色/语速/音调任一改变都要让键变化，否则「换了音色还在播旧音频」。
         Edge 服务端不吃语速音调（客户端调 AudioParam），但缓存的是合成好的字节，
         所以这两个也进键。 */
      return 'edge|' + (BF.settings.get('ttsEdgeVoice') || 'zh-CN-XiaoxiaoNeural') +
        '|' + BF.settings.num('ttsRate', 1) + '|' + BF.settings.num('ttsPitch', 1);
    },
  },
  mimo: {
    id: 'mimo', label: 'MiMo', setting: 'mimo', network: true, native: false, localOnly: false,
    canUse: function () { return BF.tts.mimo.enabled(); },
    /* 探针三问（谁来答、答什么）：
       unconfigured 没填密钥——这不是「坏了」，报 down 会把人支去查网络
       probe 真出一次门（force 时才跑；调用方负责别让它悄悄消耗配额） */
    unconfigured: function () { return !BF.tts.mimo.enabled(); },
    probe: function () {
      return BF.tts.mimo.synthesize('北风健康探针。', BF.tts.mimo.voiceId(), BF.tts.mimo.format())
        .then(function () { return { ok: true }; });
    },
    synth: function (t) { return BF.tts.mimo.synthesize(t, BF.tts.mimo.voiceId(), BF.tts.mimo.format()); },
    guideB: '。根因推测：MiMo 凭据（API Key）无效或已过期（非网络问题）。可到「设置→语音→MiMo API Key」重新填写后重试，或临时改用浏览器/Edge 语音。',
    guideBAct: { label: '去设置填 MiMo Key', set: 'mimoApiKey' },   /* 这枚输入框没有 id，按 data-set 找 */
    cfgTitle: 'MiMo 在线语音',
    cfgKeys: ['mimoApiKey', 'ttsMimoVoice', 'ttsMimoFormat'],
    cfgRows: function () {
      const mimoKey = BF.settings.get('mimoApiKey') || '';
      const mimoSel = BF.tts.mimo.VOICES.map(function (v) {
        return '<option value="' + v.id + '"' + (BF.settings.get('ttsMimoVoice') === v.id ? ' selected' : '') + '>' + v.display + '</option>';
      }).join('');
      /* 密钥那一行与上游基线逐字节对齐（验收闸门把它当锚点看）：
         搬位置可以，改写法不行——写了 type="text" 或换了变量名，
         这一行就再也对不上基线，而「输入框是不是 password」正是这条锚点守的东西。 */
      return '' +
        BF.settingsUI._row('MiMo API Key', '<input type="password" value="' + BF.dom.escAttr(mimoKey) + '" class="input" data-set-text="mimoApiKey" id="set-mimoApiKey" style="flex:1" placeholder="sk-..."/>') +
        BF.settingsUI._row('MiMo 音色', '<select class="select" data-set="ttsMimoVoice" style="flex:1">' + mimoSel + '</select>') +
        BF.settingsUI._row('MiMo 格式', BF.settingsUI._sel('ttsMimoFormat', [['wav', 'WAV'], ['mp3', 'MP3']])) +
        '<div class="pane-hint">密钥只存在这台机器的设置里，朗读时直接把当前正文发给 MiMo 接口；不想外发就把引擎策略设成「浏览器语音」。</div>';
    },
    cacheKeyOf: function () { return 'mimo|' + BF.tts.mimo.voiceId() + '|' + BF.tts.mimo.format(); },
    /* MiMo 现在不回词/句边界：timeline 返回 false，界面就不承诺逐词跟随 */
    timeline: function () { return false; },
    timelineFor: function () { return null; },
    voiceName: function () {
      const l = BF.tts.mimo && BF.tts.mimo.VOICES
        ? BF.tts.mimo.VOICES.find(function (x) { return x.id === BF.tts.mimo.voiceId(); }) : null;
      return (l && l.display) || '默认';
    },
  },
  offline: {
    id: 'offline', label: '浏览器语音', setting: 'offline', network: false, native: true, localOnly: false,
    canUse: function () { return BF.tts.offline.available(); },
    /* 本机档的「健康」是一个本地事实（有没有 voice），不必 force、也不该 force：
       对它出门探测没有意义。给一个同步结论，探针入口直接用它。 */
    localState: function () { return BF.tts.offline.available() ? 'ok' : 'down'; },
    cfgTitle: '浏览器语音',
    cfgKeys: ['ttsOfflineVoice', 'ttsRolePlay', 'ttsVoiceAltName'],
    cfgRows: function () {
      return '' +
        BF.settingsUI._row('语音选择', (function () {
        const vs = (BF.tts.offline.voices && BF.tts.offline.voices()) || [];
        const zh = vs.filter(function (v) { return /^zh/i.test(v.lang); });
        const pool = zh.length ? zh : vs;
        const cur = ((BF.tts.offline.voice && BF.tts.offline.voice()) || {}).name || '';
        if (!pool.length) return '<span class="pane-hint">还没读到本机语音（浏览器仍在加载）；点「试听」会重读一次列表</span>';
        const opts = pool.map(function (v) {
          return '<option value="' + BF.dom.escAttr(v.name) + '"' + (v.name === cur ? ' selected' : '') + '>' +
            BF.dom.esc(v.name) + (v.localService === false ? '（要联网）' : '') + '</option>';
        }).join('');
        const zhLocal = zh.filter(function (v) { return v.localService !== false; }).length;
        return '<select class="select" data-offline-voice style="flex:1">' + opts + '</select>' +
          '<button class="btn btn-xs" data-offline-try>试听</button>' +
          '<span class="pane-hint">' + (zhLocal
            ? ('本机 ' + zhLocal + ' 个中文本地语音，断网可用')
            : '⚠ 本机没有中文语音包：这一档会没有中文声音（Windows 设置 → 时间和语言 → 语言 → 添加语音）') + '</span>';
      })()) +
        /* 角色朗读与第二音色都靠 speechSynthesis 的两个 voice 轮替，
           在线档没有这条通路，所以跟着浏览器语音这一组走。 */
        BF.settingsUI._row('角色朗读', BF.settingsUI._sel('ttsRolePlay', [['true', '开启'], ['false', '关闭']])) +
        BF.settingsUI._row('角色第二音色', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('ttsVoiceAltName') || '') + '" class="input" data-set-text="ttsVoiceAltName" style="flex:1" placeholder="音色名（留空取另一中文音色）"/>');
    },
    synth: null,                       /* 不产字节：speechSynthesis 直接播，没有音频缓存可言 */
    cacheKeyOf: null,
    /* 浏览器代管播放的三个动作也交给表：回落与播放入口不再写死 offline.* */
    playNative: function (segs, pos) { BF.tts.offline.speak(segs, pos); },
    stopNative: function () { BF.tts.offline.stop(); },
    pauseNative: function () { BF.tts.offline.pause(); },
    resumeNative: function () { BF.tts.offline.resume(); },
    timeline: function () { return false; },
    timelineFor: function () { return null; },
  },
};
/* 退避阶梯与档位名都从表里派生：键序就是阶梯序，'none' 永远垫底。
   原来是两张手抄表（LADDER / EN），加一档要改两处，漏一处就是「阶梯跳不到新引擎」。 */
BF.tts.LADDER = Object.keys(BF.tts.CAPS).concat(['none']);
BF.tts.ENGINE_LABELS = (function () {
  const o = {};
  for (const k in BF.tts.CAPS) o[k] = BF.tts.CAPS[k].label;
  return o;
})();
/* cap(eng)：拿不到档位就返回 null，调用方一律按「不可用」处理，
   不再有 `if (eng === 'edge') … else if …` 的默认分支把未知档位当在线档跑。 */
BF.tts.cap = function (eng) { return (eng && BF.tts.CAPS[eng]) || null; };
/* 设置值 → 档位名：自动档返回 null（意思是「不指定」，不是「有个叫 auto 的引擎」）。
   表里没有的值名同样返回 null，所以加引擎时漏写 setting，现象是「这一档选不中」
   而不是「按未知引擎跑」——后者会更难查。 */
BF.tts.engOfSetting = function (t) {
  if (t == null || t === '' || t === 'auto') return null;
  for (const k in BF.tts.CAPS) {
    const c = BF.tts.CAPS[k];
    if (k === t || c.setting === t) return k;
  }
  return null;
};
/* 档位名 → 设置值（下拉与「改用在线引擎」这类写回用） */
BF.tts.settingOfEng = function (eng) {
  const c = BF.tts.CAPS[eng];
  return c ? (c.setting || eng) : eng;
};
/* 当前策略指定的档位；自动档返回 null。原来各处各写一遍三目，
   加一档联网引擎要回头找六处 `t === 'online' ? 'edge' : …`。 */
BF.tts.forcedEngine = function () {
  const t = BF.settings.get('ttsEngine') || 'auto';
  const eng = BF.tts.engOfSetting(t);
  return eng && BF.tts.CAPS[eng] ? eng : null;
};
/* 阶梯里第一个「浏览器代管播放」的档位 = 回落终点。
   原来回落点写死 offline；再加一档本机引擎时，那个写死的名字会挡住它。 */
BF.tts.nativeEngine = function () {
  for (const e of BF.tts.LADDER) {
    const c = BF.tts.CAPS[e];
    if (c && c.native) return e;
  }
  return null;
};
/* 设置面板该画哪几档的专属行：
   自动档 = 阶梯上所有档（它真会用到每一条出口）；显式档 = 只有点名的那一档。
   没有 cfgRows 的档不参与分组（探针、缓存这类共享行由面板自己管）。 */
BF.tts.configurableEngines = function () {
  const forced = BF.tts.forcedEngine();
  const all = BF.tts.LADDER.filter(function (e) {
    const c = BF.tts.CAPS[e];
    return !!(c && c.cfgRows);
  });
  if (!forced) return all;
  return all.filter(function (e) { return e === forced; });
};
/* 被当前策略收起来的档（面板用它解释「为什么这里少了几行」并给出一条切过去的出口） */
BF.tts.hiddenConfigEngines = function () {
  const shown = BF.tts.configurableEngines();
  return BF.tts.LADDER.filter(function (e) {
    const c = BF.tts.CAPS[e];
    return !!(c && c.cfgRows) && shown.indexOf(e) < 0;
  });
};
/* 换了引擎策略的即时收尾，两条入口（设置里的下拉、行集提示上的「切到某档」）共用一份：
   停播——stop 里的 _pfClear 会问每一档撤掉自己的在途请求，
   不这么做的话旧引擎那条请求照样回来并接着播，两种音色夹着播，
   而界面上引擎已经换了，看起来就是「切档没生效」。
   语音那一屏的行集不在这里重建：SETTINGS 广播那条订阅是唯一入口（见 engineSwitchWatch），
   两条路各建一次会画两遍，而且 DSL / 恢复默认 / 跨标签同步那些路就漏了。 */
BF.tts.applyEnginePolicy = function () {
  try { BF.tts.stop(); } catch (e) {}
};
BF.tts.stab = (function () {
  /* 全部阈值走 BF.CONFIG.TTS_STAB（实时读取，harness 可运行期改短值） */
  function cfg(k, d) { const v = BF.CONFIG && BF.CONFIG.TTS_STAB && BF.CONFIG.TTS_STAB[k]; return (v == null) ? d : v; }
  /* G 类：decodeAudioData 抛的原生 EncodingError——服务端
     回了字节但不是本浏览器能解的音频容器（容器与解码器对不上）。它不带
     .code，且 message「Unable to decode audio data」在归一正则表里一条都不匹配，
     落到初值 D=超时就会被当网络抖动白退避重试 2 次——重试的是同一份
     字节，必然同样失败，用户还被告知是瞬时错误。故单开一类：
     不重试、不进黑表（同 F 类设计），但文案不能复用 F 的
     「离线/无可用能力」——那对解码失败是误导。 */
  const CODES = { A: '离线', B: '凭据', C: '协议', D: '超时', E: '限流', F: '无可用能力', G: '音频解码' };
  const TIERS = { A: 'T4', B: 'T3', C: 'T3', D: 'T1', E: 'T2', F: 'T4', G: 'T4' };
  /* 阶梯与档位名从能力表派生：原来是两张手抄表，加一档要改两处、漏一处就跳不到新引擎 */
  const LADDER = BF.tts.LADDER;
  const EN = BF.tts.ENGINE_LABELS;
  const CAPS = BF.tts.CAPS;

  function offlineNow() { try { return navigator.onLine === false; } catch (e) { return false; } }
  function sleep(ms) { return new Promise(function (r) { BF.timers.timeout(r, ms); }); }

  /* ---------- 错误归一表（A–G） ---------- */
  function mkErr(code, message, raw) {
    const e = new Error(message);
    e.code = code;                                  /* 归一点：throw 处打标 */
    e.raw = (raw && typeof raw === 'object')
      ? { status: raw.status || 0, retryAfter: raw.retryAfter || null }   /* 白名单：不含请求头 */
      : {};
    return e;
  }
  function classify(e) {
    /* 已打标错误直接归一；未打标（第三方/历史抛错）按表兜底推断 */
    if (e && e.code && CODES[e.code]) {
      return { code: e.code, tier: TIERS[e.code], status: (e.raw && e.raw.status) || 0,
        retryAfter: (e.raw && e.raw.retryAfter) || null, retries: e._retries || 0, message: e.message || '',
        budgetBlown: !!e.budgetBlown };   /* 预算硬顶标记要透传：handleFailure 按它决定记不记黑表 */
    }
    /* G：音频解码失败。decodeAudioData 抛的是原生 EncodingError
       —— DOMException，WebIDL 的 name 是规范正式名，跨浏览器一致；message
       各家措辞不同且随版本变（Chrome「Unable to decode audio data」、
       Firefox「Unable to decode」/「The audio data could not be decoded」，
       中文版「音频解码失败」）。先判原生异常（name 精确命中，不依赖任何
       本地化文案，是主判据），再拿 message 正则兜底吃本地化与措辞变体；
       正则写成词序无关（"Audio decode failed""the audio data could not be
       decoded" 都要命中）。
       前提：解码失败不带 HTTP status——status 是 HTTP 错误的强信号，优先于
       文案推断。故仅在无 HTTP 状态码时启用文案兜底，status 分支顺序不变。
       放在取 msg 之前：否则一条不匹配就落回初值 D=超时，
       白退避重试同一份解不了的字节。 */
    const rawMsg = String((e && e.message) || e || '');
    const httpStatus = (e && e.status) || 0;
    const isEncoding = !!(e && e.name === 'EncodingError')
      || (httpStatus < 400 && (
        (/\bdecod(?:e|ed|ing)\b/i.test(rawMsg) && /audio/i.test(rawMsg))
        || /解码/.test(rawMsg)));
    if (isEncoding) {
      return { code: 'G', tier: TIERS.G, status: (e && e.raw && e.raw.status) || 0,
        retryAfter: null, retries: (e && e._retries) || 0, message: (e && e.message) || '' };
    }
    const msg = rawMsg;
    const status = (e && e.status) || 0;
    let code = 'D';
    if (offlineNow()) code = 'A';
    else if (status === 401 || status === 403 || /unauthorized|forbidden|凭据|密钥|api.?key/i.test(msg)) code = 'B';
    else if (status === 429 || status >= 500) code = 'E';
    else if (status >= 400) code = 'C';
    else if (/timeout|超时|abort/i.test(msg)) code = 'D';
    else if (/network|offline|failed to fetch|网络|连接|econn/i.test(msg)) code = 'D';
    else if (/protocol|协议|版本|version|parse|解析|unexpected|无音频|响应/i.test(msg)) code = 'C';
    else if (/不支持|不可用|需要 edge|not supported|no voice/i.test(msg)) code = 'F';
    return { code: code, tier: TIERS[code], status: status, retryAfter: null, retries: (e && e._retries) || 0, message: msg };
  }

  /* ---------- 失败黑表（带 TTL，内存态不落存储） ---------- */
  const TTL_DEFAULT = { B: 900000, C: 900000, E: 60000, D: 300000 };
  function ttlOf(code) { const t = cfg('TTL', TTL_DEFAULT); return (t && t[code]) || TTL_DEFAULT[code] || 300000; }
  const _black = new Map();   /* eng → { until, code, at } */
  function blacklist(eng, code) {
    const ttl = ttlOf(code);
    _black.set(eng, { until: Date.now() + ttl, code: code, at: Date.now() });
    BF.log.info('TTS 黑表：' + EN[eng] + ' 类' + code + '（' + CODES[code] + '）禁 ' + Math.round(ttl / 1000) + 's');
    lampRefresh();            /* 探针触发③：黑表进 → 三态灯刷新 */
  }
  function isBlacked(eng) {
    const b = _black.get(eng);
    if (!b) return false;
    if (Date.now() >= b.until) {
      _black.delete(eng);     /* TTL 生效自动出表（惰性判定，零常驻定时器） */
      BF.log.info('TTS 黑表：' + EN[eng] + ' TTL 到出表');
      lampRefresh();          /* 探针触发③：黑表出 → 按需复核 */
      return false;
    }
    return true;
  }
  function blackInfo(eng) { return _black.get(eng) || null; }

  /* ---------- R3 引擎级去抖 ---------- */
  const _coolUntil = (function () {
    /* 引擎级去抖只对**有出站网络口**的档位有意义：离线档不联网，
       给它记一个冷却时间是「浏览器语音暂时听不了」这种荒谬结论。
       名单从能力表派生，加一档联网引擎不必回来补一格。 */
    const o = {};
    for (const k in BF.tts.CAPS) { if (BF.tts.CAPS[k].network) o[k] = 0; }
    return o;
  })();
  function cool(eng, ms) { if (_coolUntil[eng] != null) _coolUntil[eng] = Date.now() + Math.max(ms, 0); }
  function cooling(eng) { return _coolUntil[eng] ? Date.now() < _coolUntil[eng] : false; }

  /* ---------- 可用性 ---------- */
  function avail(eng) {
    /* 只认能力表：表里没这个名字就是不可用。
       过去这里是三条 `if (eng === …)`，加一档引擎忘了改 → 永远「不可用」，
       而且现象是静默回落，看不出是名单漏了。 */
    const cap = CAPS[eng];
    return !!(cap && cap.canUse());
  }
  function usable(eng) {
    const cap = CAPS[eng];
    if (!cap || !cap.canUse()) return false;
    /* 黑表与去抖只约束**联网档**：它们记的是「这条网络出口刚失败过」，
       与浏览器语音这种本机播放无关。 */
    if (cap.network && (isBlacked(eng) || cooling(eng))) return false;
    /* 探针新鲜结论（PROBE_GATE_MS 窗口内）参与判定：
       探针判为不可通的引擎自动档暂不选（三态灯与路由
       一致）；其结论随时间自然过期，不落存储 */
    const p = cap.network ? _probeState[eng] : null;
    if (p && p.state === 'down' && Date.now() - p.at < cfg('PROBE_GATE_MS', 60000)) return false;
    return true;
  }

  /* ---------- 退避策略 + 重试预算 ---------- */
  function parseRetryAfter(h) {
    if (!h) return 1000;
    const n = parseInt(String(h).trim(), 10);
    if (n > 0) return Math.min(Math.max(n * 1000, 1000), cfg('RETRY_AFTER_MAX', 30000));
    const t = Date.parse(h);
    if (!isNaN(t)) return Math.min(Math.max(t - Date.now(), 1000), cfg('RETRY_AFTER_MAX', 30000));
    return 1000;
  }
  function policyFor(cls) {
    if (cls.tier === 'T1') {
      const b = cfg('T1_BACKOFF', [300, 1200]);
      return { retries: cfg('T1_RETRIES', 2), wait: function (a) { return b[Math.min(a, b.length - 1)]; } };
    }
    if (cls.tier === 'T2') return { retries: cfg('T2_RETRIES', 1), wait: function (a, c) { return parseRetryAfter(c.retryAfter); } };
    return { retries: 0, wait: function () { return 0; } };   /* T3/T4：不重试 */
  }
  let _budgetUsed = 0;          /* 单次播放重试预算（已用次数） */
  let _offlineFlight = false;   /* 离线回落单飞守卫 */
  let _wdT = null, _wdRound = 0;   /* 心跳监测 */
  let _notiGate = new Map();    /* 提示节流闸①：同类错误 30s 1 条 */
  let _tempEngine = null;       /* 临时改用（内存态，stop 清；设置不改） */
  function beginPlayback() {
    _budgetUsed = 0;
    _offlineFlight = false;
    _wdRound = 0;
  }
  /* R1 分类退避重连 + R2 预算硬顶：归一点在 throw 处打标，本函数只做两分支 */
  function synthesizeWithRetry(seg, eng) {
    /* 文本 → 音频这件事只问能力表。表里没这一档或这一档不产字节，
       抛 F（无可用能力）而不是 TypeError：后者会被 classify 兜底认成 D=超时，
       白退避重试两次，还告诉用户「瞬时错误」。 */
    const cap = CAPS[eng];
    if (!cap || !cap.synth) return Promise.reject(mkErr('F', (EN[eng] || eng) + ' 不产音频字节，无法合成', {}));
    const synth = cap.synth;
    const t0 = Date.now();
    let attempt = 0;
    return (function loop() {
      return synth(seg).catch(function (e) {
        const cls = classify(e);
        /* R2：预算上界 + 30s 单句硬顶；超限判 D 超预算（黑表 300s），不无限重试 */
        if (_budgetUsed >= cfg('BUDGET_CAP', 8) || Date.now() - t0 >= cfg('SEG_CAP_MS', 30000)) {
          const blown = mkErr('D', '重试预算超限（单次播放重试达上界或单句超 30s 硬顶）', { status: cls.status });
          blown.budgetBlown = true;
          throw blown;
        }
        const pol = policyFor(cls);
        if (attempt >= pol.retries) { e._retries = attempt; throw e; }   /* 重试用尽：交调用方走阶梯 */
        const waitMs = pol.wait(attempt, cls);
        cool(eng, Math.max(waitMs, cfg('COOL_T1_MS', 1500)));   /* R3：重连去抖 */
        _budgetUsed++;   /* R2 记账 */
        return sleep(waitMs).then(function () {
          if (BF.tts.state._stopIntent) { e._retries = attempt; throw e; }
          attempt++;
          return loop();
        });
      });
    })();
  }

  /* ---------- 心跳监测 ---------- */
  function watchdogStart() {
    watchdogStop();
    _wdRound = 0;
    _wdT = BF.timers.timeout(wdFire, cfg('WATCHDOG_MS', 60000));
  }
  function watchdogFeed() {
    if (!_wdT) return;                 /* 非播放态不喂 */
    _wdT();
    /* F1：有效语音事件重置复苏轮次——_wdRound 按「连续
       无事件」计数而非单次播放累计。慢速引擎长段落
       （0.5x 语速 ≥180s）或任意语速多个 >60s 间隔，
       有事件即清零，不至累计 3 次误判停 */
    _wdRound = 0;
    _wdT = BF.timers.timeout(wdFire, cfg('WATCHDOG_MS', 60000));
  }
  function watchdogStop() { if (_wdT) { _wdT(); _wdT = null; } }
  function wdFire() {
    if (!BF.tts.state.playing || BF.tts.state._stopIntent) { watchdogStop(); return; }
    _wdRound++;
    if (_wdRound > cfg('WD_ROUNDS', 2)) {
      /* pause/resume 两轮无效 → 判停 */
      watchdogStop();
      BF.log.error('TTS 心跳看门狗判停：' + Math.round(cfg('WATCHDOG_MS', 60000) / 1000) + 's 无语音事件，复苏 ' + cfg('WD_ROUNDS', 2) + ' 轮无效');
      BF.noti.error('朗读 ' + Math.round(cfg('WATCHDOG_MS', 60000) / 1000) + ' 秒无进度且复苏无效，已自动停止。请重新点播放。');
      BF.tts.stop();
      return;
    }
    BF.log.warn('TTS 心跳看门狗：' + Math.round(cfg('WATCHDOG_MS', 60000) / 1000) + 's 无语音事件，pause/resume 复苏第 ' + _wdRound + ' 轮');
    /* pause/resume 复苏只对「浏览器代管播放」的档位有意义：
       在线档放的是自己解出来的 Audio，pause 它等于用户按暂停，不是复苏。 */
    const wdCap = CAPS[BF.tts.state.engine];
    if (wdCap && wdCap.native) {
      try { wdCap.pauseNative(); wdCap.resumeNative(); } catch (e) {}
    }
    _wdT = BF.timers.timeout(wdFire, cfg('WATCHDOG_MS', 60000));
  }

  /* ---------- 四级阶梯 + 失败处理 ---------- */
  function nextRung(curEng) {
    /* 阶梯从能力表派生，逐档只问 usable()：
       原来这里对 offline 单开一条 `available() ? 'offline' : 'none'`，
       新加一档本机引擎就会跳过它直接落到 none。 */
    const i = LADDER.indexOf(curEng);
    for (let n = i + 1; n < LADDER.length; n++) {
      const cand = LADDER[n];
      if (cand === 'none') return 'none';
      if (usable(cand)) return cand;
    }
    return 'none';
  }
  function takeOfflineFlight() {
    if (_offlineFlight) return false;   /* R4 单飞：已回落过则不再并发第二次 */
    _offlineFlight = true;
    return true;
  }
  function handledDesc(cls) {
    if (cls.budgetBlown) return '重试预算超限，当前引擎入黑表 ' + Math.round(ttlOf('D') / 1000) + 's';
    if (cls.tier === 'T3') return '凭据/协议类不重试，当前引擎入黑表 ' + Math.round(ttlOf(cls.code) / 1000) + 's';
    if (cls.code === 'E') return '已按 Retry-After 退避重试 ' + (cls.retries || 0) + ' 次仍失败，入黑表 ' + Math.round(ttlOf('E') / 1000) + 's';
    if (cls.tier === 'T1') return '瞬时错误已退避重试 ' + (cls.retries || 0) + ' 次仍失败';
    /* G 必须先于下面这条 T4 共用分支：解码失败同样是 T4，但「离线/无可用能力」
       对它不成立——引擎是通的、有凭据、有网络，只是这批字节解不开。
       与 F 类同设计：不重试、不进黑表，但文案说清「为什么不再试」。 */
    if (cls.code === 'G') return '解码失败，已停止重试（重试同一份音频不会成功），可换音色或切引擎';
    if (cls.tier === 'T4') return '离线/无可用能力，不重试';
    return '已按分类策略处理';
  }
  /* 失败提示的「第四段」：一个能直接跳到对应设置行的动作。
     原来每条文案各自手抄一遍「开面板 + 等一帧 + 找输入框」，且找法三种混用
     （getElementById / _ctl / querySelector）。控件一律走 _ctl：
     它按 data-set / data-set-text 认键，新增设置行不必再造 id。 */
  function guideAction(spec) {
    if (!spec) return null;
    return {
      label: spec.label,
      run: function () {
        try { if (BF.settingsUI && BF.settingsUI.open) BF.settingsUI.open('tts'); } catch (e) {}
        BF.timers.timeout(function () {
          try { const el = BF.settingsUI._ctl(spec.set); if (el) el.focus(); } catch (e) {}
        }, 250);
      },
    };
  }
  function failNotify(eng, cls, opts) {
    opts = opts || {};
    /* 三道提示节流闸：①同类错误 30s 1 条；②黑表期静默；③批量合并（同 tick 同类由闸①覆盖） */
    const key = eng + ':' + cls.code;
    const now = Date.now();
    if (now - (_notiGate.get(key) || 0) < cfg('NOTI_GATE_MS', 30000)) return;
    if (opts.wasBlacked) return;
    _notiGate.set(key, now);
    /* 四段式文案：失败了什么 + 已怎么处理 + 你能点什么（动作按钮为第四段）。
       A–G / T1–T4 是诊断码，只留在日志里：吐司上拼一串「分类 B（凭据）·T3」
       用户读不出信息，只会多一行看不懂的字符。 */
    const cap = CAPS[eng];
    const what = (cap && cap.label) || EN[eng] || eng;
    let msg = what + ' 朗读失败：' + (cls.message || CODES[cls.code]);
    const done = opts.handled || '';
    msg = msg + (done ? '（已处理：' + done + '）' : '');
    BF.log.info('TTS 失败诊断码 ' + eng + ' 分类 ' + cls.code + '（' + (CODES[cls.code] || '') + '）·' + cls.tier);
    let act = opts.action || null;
    /* N5 延伸：凭据类（401/403 / 未配置）= 内置或用户填的 Token/Key 失效。
       一等诊断 + 引导用户到「设置→语音」自填，替代「静默回退离线」。
       根因文案与出口控件都在能力表那一行里，加引擎不必回头扩这条 if 链。 */
    if (cap && cap.guideB && cls.code === 'B') {
      msg += cap.guideB;
      if (!act) act = guideAction(cap.guideBAct);
    }
    /* 音色不被支持是配置问题，不是凭据问题：
       混进 B「凭据过期」会让用户去换 Token 白忙——
       服务端 close 1007 已明说「Unsupported voice …」。
       这里单开一段：明示换音色，并直接给出「去设置换音色」出口。 */
    if (cap && cap.guideF && cls.code === 'F' && (!cap.guideFWhen || cap.guideFWhen.test(cls.message || ''))) {
      msg += cap.guideF;
      if (!act) act = guideAction(cap.guideFAct);
    }
    /* 解码失败（G）与 B（凭据）、F 音色同理单开一段——
       用户最容易走的弯路正是「换 Token」「等一会重试」，两者都没用，
       反复自找。明确排除这两条路，再给出真正有效的出口。 */
    if (cls.code === 'G') {
      msg += '。根因推测：引擎回了音频，但这份音频本浏览器解不开（容器与解码器对不上，不是网络问题）。换 Token 没用，等一会重试也没用：同一份字节重试仍会失败。有效做法：换一个音色（音色对应的编码可能不同），或把引擎切成另一个（如切到浏览器语音）。';
    }
    BF.noti.warn(msg, act ? { action: { label: act.label, run: act.run } } : undefined);
  }
  function tempUse(eng) {
    _tempEngine = eng;
    BF.log.info('TTS 临时改用：' + EN[eng] + '（内存态，仅本次播放生效，设置未改）');
  }
  function clearTemp() { _tempEngine = null; }
  function tempAction(curEng) {
    /* 「临时改用」出口：扫阶梯取最优可用档（排除当前档），不静默换引擎 */
    for (const cand of LADDER) {
      if (cand === 'none' || cand === curEng) continue;
      if (!usable(cand)) continue;
      const nm = EN[cand];
      return { label: '临时改用' + nm, run: function () { tempUse(cand); BF.noti.info('已临时改用' + nm + '（设置未改动）'); BF.tts.start(); } };
    }
    return null;
  }
  /* 失败总入口：分类记账（黑表/去抖）→ 自动档走四级阶梯、显式档报错不换引擎 */
  function handleFailure(eng, e, ctx) {
    const cls = classify(e);
    try { if (BF.tts.health) BF.tts.health.notePlayFailure(); } catch (e3) {}
    const wasBlacked = isBlacked(eng);
    if (cls.budgetBlown) blacklist(eng, 'D');
    else if (cls.code === 'B' || cls.code === 'C') blacklist(eng, cls.code);
    else if (cls.code === 'E') blacklist(eng, 'E');
    if (cls.tier === 'T1') cool(eng, cfg('COOL_T1_MS', 1500));
    const handled = handledDesc(cls);
    /* 显式档：不静默换引擎——只报错 + 提供「临时改用」动作 */
    if (BF.tts.forcedEngine()) {
      BF.tts.state.playing = false;
      BF.tts._setPhase('error');
      BF.tts.setPlayIcon(false);
      watchdogStop();
      failNotify(eng, cls, { explicit: true, wasBlacked: wasBlacked, handled: handled, action: tempAction(eng) });
      return 'explicit-stop';
    }
    /* 自动档：四级阶梯按能力表键序回落（edge→mimo→offline→none），
       加一档引擎只要写在表里，这里不必再补一个名字分支 */
    const next = nextRung(eng);
    const nextCap = CAPS[next];
    if (nextCap && nextCap.native) {
      if (!takeOfflineFlight()) return 'offline-guard';   /* R4 单飞 */
      BF.tts.state.engine = next;
      BF.tts._pfClear();
      try { nextCap.stopNative(); } catch (e2) {}
      BF.tts.updateVoiceLabel(next);
      failNotify(eng, cls, { wasBlacked: wasBlacked, handled: handled + '；已回落' + EN[next] });
      lampRefresh();
      nextCap.playNative(ctx.segs, ctx.pos);
      return next;
    }
    if (nextCap) {
      BF.tts.state.engine = next;
      BF.tts._pfClear();
      BF.tts.updateVoiceLabel(next);
      failNotify(eng, cls, { wasBlacked: wasBlacked, handled: handled + '；已切换' + EN[next] + '引擎继续' });
      lampRefresh();
      BF.tts.onlineSpeak(ctx.segs, ctx.pos, next, true);   /* R2：预算不重置 */
      return next;
    }
    /* 阶梯耗尽（none） */
    BF.tts.state.playing = false;
    BF.tts.setPlayIcon(false);
    watchdogStop();
    failNotify(eng, cls, { wasBlacked: wasBlacked, handled: handled + '；阶梯 ' + LADDER.slice(0, -1).map(function (x) { return EN[x]; }).join('→') + '→none 已耗尽' });
    lampRefresh();
    return 'none';
  }

  /* ---------- 按需健康探针（零常驻定时器） ---------- */
  const _probeState = (function () {
    /* 结论槽按能力表建：加一档引擎不必回来补一格，
       漏格的后果是 noteProbe 把结论写进一个没人读的属性。 */
    const o = {};
    for (const k in CAPS) o[k] = null;
    return o;
  })();
  const LAMP = { ok: '✓可用', limited: '⚠受限', down: '✗不可用', unknown: '未测', unconfigured: '未配置' };
  function rungs() { return LADDER.filter(function (e) { return e !== 'none'; }); }
  function noteProbe(eng, state) {
    _probeState[eng] = { state: state, at: Date.now() };
    BF.log.info('TTS 健康探针[' + EN[eng] + ']：' + (LAMP[state] || state));
    lampRefresh();
  }
  function probe(eng, force) {
    /* 探针入口不许把异常抛给调用方：它常在 forEach 里 fire-and-forget，
       一处档位自测炸掉会带走后面几档。判不出就报不可用。 */
    try { return _probe(eng, force); } catch (e) { noteProbe(eng, 'down'); return Promise.resolve('down'); }
  }
  function _probe(eng, force) {
    /* 联网探测一律要显式 force（用户在设置里点「测一次连接」，或合成真的失败过）：
       打开设置面板不该悄悄向微软发一次请求、也不该拿用户的 MiMo 密钥发一次合成
       ——既花配额，也是一次「用户没同意的出门」。
       不 force 时只回本地事实（能不能用、上次探到的结论）。 */
    const cap = CAPS[eng];
    if (!cap) return Promise.resolve('down');
    const last = _probeState[eng];
    if (last && !force && Date.now() - last.at < cfg('PROBE_STALE_MS', 60000)) return Promise.resolve(last.state);
    /* 本机档：结论是本地事实，不走 force 那条门 */
    if (cap.localState) {
      const s0 = cap.localState();
      noteProbe(eng, s0);
      return Promise.resolve(s0);
    }
    /* 「没配好」单列一档：报成 down 会把用户支去查网络，而真正要做的只是填密钥 */
    if (cap.unconfigured && cap.unconfigured()) {
      noteProbe(eng, 'unconfigured');
      return Promise.resolve('unconfigured');
    }
    if (!cap.canUse()) { noteProbe(eng, 'down'); return Promise.resolve('down'); }
    if (!cap.probe || !force) {
      const s1 = last ? last.state : 'unknown';
      noteProbe(eng, s1);
      return Promise.resolve(s1);
    }
    let pr;
    try { pr = Promise.resolve(cap.probe()); } catch (e) { pr = Promise.reject(e); }
    return pr.then(function (p) {
      const ok = !!(p && p.ok);
      /* 连原因一起进日志：403 与超时是两回事，
         只报「不可用」会把用户支去换 Token */
      BF.log.info(EN[eng] + ' 连接探针：' + (ok ? '成功' : '失败') + '·' + ((p && p.reason) || ''));
      const s = ok ? 'ok' : ((p && p.state) || 'down');
      noteProbe(eng, s);
      return s;
    }).catch(function (e2) {
      /* 探针自己炸：按错误分类给结论。限流（E）算「受限」——这一档是通的，
         只是配额到了；其余算不可用。 */
      const s = classify(e2).code === 'E' ? 'limited' : 'down';
      noteProbe(eng, s);
      return s;
    });
  }
  function probeAll(force) {
    rungs().forEach(function (eng) { probe(eng, force); });   /* fire-and-forget：结果落 BF.log + 内存态 + 三态灯 */
  }
  /* 各引擎当前结论的人话一行（设置面板与探测按钮共用） */
  function lampText() {
    return rungs().map(function (eng) {
      const p = _probeState[eng];
      return EN[eng] + ' ' + (p ? (LAMP[p.state] || p.state) : LAMP.unknown);
    }).join(' · ');
  }
  /* 三态灯：可用 / 受限 / 不可用（只写 BF.log + 内存态 + 顶栏指示器，
     不写 localStorage）。灯随路由与健康信号走：
     已启用引擎全部健康 → 可用；有已启用引擎降级（黑表/
     冷却/探针不可用或限流）但仍有路可走 → 受限；
     全部无路可走 → 不可用。未配置的引擎不算降级。 */
  function probeDegraded(eng) {
    const p = _probeState[eng];
    /* 「未测」不是「降级」：没探测过不能算进「受限」，否则顶栏一进来就报引擎受限 */
    return !!(p && p.state !== 'ok' && p.state !== 'unknown' && Date.now() - p.at < cfg('PROBE_GATE_MS', 60000));
  }
  function overallHealth() {
    /* 本机档（native 行）与联网档（network 行）各归一类：
       原来这里逐条写死 offline/edge/mimo 的名字，加一档就少算一档。 */
    const forced = BF.tts.forcedEngine();
    const allowOnline = BF.settings.get('ttsAutoOnline') !== false;
    const list = rungs();
    const localOk = list.some(function (e) { return !CAPS[e].network && CAPS[e].canUse(); });
    if (forced) {
      const c = CAPS[forced];
      if (!c.network) return c.canUse() ? 'ok' : 'down';
      return usable(forced) ? 'ok' : (localOk ? 'limited' : 'down');
    }
    if (!allowOnline) return localOk ? 'ok' : 'down';
    const online = list.filter(function (e) { return CAPS[e].network; });
    const anyHealthy = online.some(function (e) { return CAPS[e].canUse() && usable(e); });
    const anyDegraded = online.some(function (e) { return CAPS[e].canUse() && (!usable(e) || probeDegraded(e)); });
    if (anyHealthy) return anyDegraded ? 'limited' : 'ok';
    /* F-05：「未配置」不是「降级」——一个在线档都没解锁时不该报受限，
       否则干净 profile 首启就顶着橙色「⚠ 引擎受限」。只有已解锁但不可用才是 limited。 */
    const anyConfigured = online.some(function (e) { return CAPS[e].canUse(); });
    if (!anyConfigured) return localOk ? 'ok' : 'down';
    return localOk ? 'limited' : 'down';
  }
  function lampRefresh() {
    try {
      const label = document.getElementById('tts-status-label');
      const health = overallHealth();
      const st = BF.tts.state || {};
      const engName = EN[st.engine] || '';
      /* 只按 overallHealth 写文案 = 灯只回答「能不能用」，不回答「现在用的是谁、有没有在出声」。
         health='limited' 而正在用浏览器语音时，灯上写「TTS 不可用」，
         它却正在出声朗读。正在播就一定可用，出声引擎名比健康度更贴近用户此刻的事实。 */
      const txt = (st.playing && engName) ? (engName + '朗读中')
        : health === 'ok' ? '语音就绪'
        : health === 'limited' ? '⚠ 引擎受限'
        : '✗ TTS 不可用';
      const tip = (st.playing && engName) ? ('当前出声引擎：' + engName)
        : health === 'ok' ? ''
        : health === 'limited' ? '部分朗读引擎暂不可用，已自动降级'
        : '所有朗读引擎不可用';
      if (label) { label.textContent = txt; label.title = tip; }
      const playCap = CAPS[st.engine];
      const dot = document.getElementById('tts-dot');
      /* 点色看的是「这一档走不走网络」：浏览器语音没有网络出口，绿点会被读成「在线服务正常」 */
      if (dot) dot.className = 'dot ' + (health === 'down' || (playCap && !playCap.network) ? 'offline' : 'online');
    } catch (e) {}
  }

  return {
    CODES: CODES, TIERS: TIERS, LADDER: LADDER,
    mkErr: mkErr, classify: classify,
    blacklist: blacklist, isBlacked: isBlacked, blackInfo: blackInfo, ttlOf: ttlOf,
    cool: cool, cooling: cooling,
    avail: avail, usable: usable,
    beginPlayback: beginPlayback, synthesizeWithRetry: synthesizeWithRetry,
    handleFailure: handleFailure, nextRung: nextRung, takeOfflineFlight: takeOfflineFlight,
    watchdogStart: watchdogStart, watchdogFeed: watchdogFeed, watchdogStop: watchdogStop,
    probe: probe, probeAll: probeAll, noteProbe: noteProbe, lampRefresh: lampRefresh, overallHealth: overallHealth, lampText: lampText,
    tempUse: tempUse, clearTemp: clearTemp, tempAction: tempAction,
    get tempEngine() { return _tempEngine; },   /* 临时改用（pickEngine 消费；内存态） */
    offlineNow: offlineNow,
    /* 内部态快照（运行态只读视图，供调试观察） */
    _snapshot: function () {
      const blk = {}, cl = {};
      for (const k in CAPS) { blk[k] = blackInfo(k); cl[k] = _coolUntil[k]; }
      return {
        budgetUsed: _budgetUsed, offlineFlight: _offlineFlight,
        wdRound: _wdRound, wdArmed: !!_wdT,
        black: blk, coolUntil: cl,
        tempEngine: _tempEngine, probeState: _probeState,
      };
    },
  };
})();

