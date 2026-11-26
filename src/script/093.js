/* ================= T5. 路由 ================= */
BF.tts.pickEngine = function () {
  /* 在线/离线降级开关：ttsAutoOffline / ttsAutoOnline 必须在这里生效，
     否则「引擎策略 = 自动」会无视用户是否允许联网朗读 */
  const stab = BF.tts.stab;
  const allowOnline = BF.settings.get('ttsAutoOnline') !== false;
  const allowOffline = BF.settings.get('ttsAutoOffline') !== false;
  /* 临时改用优先（内存态，仅当次播放生效；stop() 清除，设置本身未改） */
  if (stab.tempEngine && stab.avail(stab.tempEngine)) return stab.tempEngine;
  /* 显式档不静默换引擎：引擎不可用返回 none（启动处报错 +
     「临时改用」出口），绝不自动回落到浏览器语音 */
  const forced = BF.tts.forcedEngine();
  if (forced) {
    const fc = BF.tts.cap(forced);
    /* 本机档不检查 avail：启动处按「有没有语音」给专门的提示与出口，
       在这里返回 none 会把那条更准确的文案吃掉 */
    return fc.network ? (stab.avail(forced) ? forced : 'none') : forced;
  }
  /* 自动档：沿能力表派生的阶梯下探，跳过黑表/冷却/探针判死的联网档 */
  for (const e of BF.tts.LADDER) {
    if (e === 'none') return 'none';
    const c = BF.tts.cap(e);
    if (c.network) {
      if (!allowOnline || !stab.usable(e)) continue;
      return e;
    }
    return allowOffline ? e : 'none';
  }
  return 'none';
};

/* 引擎标识不能滞后：state.engine 若只在 start 里赋值，speakOnce / selSpeak / onlineSpeak
   三条入口各自都已经真正决定了用哪个引擎合成，标识却从不更新——直接调它们
   时它停在初值 'offline'。后果就是「明明能出声却显示浏览器语音」：
   Edge/MiMo 真的在发声，顶栏圆点（lampRefresh 读 state.engine）与设置面板
   仍按 offline 着色。
   本函数收成幂等单点，各入口在引擎真正定下来的那一刻调它，阶梯下探（handleFailure
   里已有两处直写）之后仍会被本函数的调用点收敛到同一个值。
   只写标识、不碰音色标签：updateVoiceLabel 由 start / handleFailure 负责——那两处
   接管整章播放态；而 speakOnce/selSpeak 是临时试读，改标签会把整章的标签说错。
   'none' 不是生效引擎而是「不可用」的早退信号，不写（否则顶栏会显示一个没有
   对应实现的档）。 */
BF.tts._setEngine = function (eng) {
  if (!eng || eng === 'none') return;
  if (BF.tts.state.engine === eng) return;
  BF.log.info('TTS 引擎标识：' + BF.tts.state.engine + ' → ' + eng);
  BF.tts.state.engine = eng;
};

/* ============================================================
   北风 · tts 域（二）：主朗读流程 + 在线播放 + 保活
   ============================================================ */

