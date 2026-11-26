/* ================= T15. 模块注册 ================= */
BF.modules.register({
  id: 'tts.core',
  name: 'TTS 朗读',
  desc: 'EdgeTTS/mimo 语音朗读与定时',
  version: '1.0',
  enabled: true,
  deps: ['core.store', 'core.settings', 'reader.core'],
  hooks: {
    install() { BF.tts.init(); BF.tts.updateTimerUI(); },
    uninstall() { BF.tts.stop(); },
  },
});

/* ============================================================
   北风 · ai 域（一）：provider 列表 + 网关 + 密钥存储
   服务商表里的 key 一律留空：密钥只住本机设置，不进程序本体。
   ============================================================ */
BF.ai = BF.ai || {};

