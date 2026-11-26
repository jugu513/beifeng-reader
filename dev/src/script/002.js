/* ================= 全局可调常量（唯一实现） =================
   超时、阈值、上限、冷却时间一律在此集中声明，模块内引用
   BF.CONFIG.*，局部别名只为少打几个字符；散落在各模块的局部 var
   改一个值要翻遍全文件，且无法集中审阅。 */
BF.CONFIG = {
  /* Edge TTS 凭据：微软 Edge 读 aloud 的公开 TrustedClientToken 会轮换，
     硬编码在模块内 → 微软一换版本号，Edge 引擎静默失效（用户只看到「朗读没声音」）。
     提到 CONFIG 集中管理，可覆盖；引擎失败时给可诊断提示。 */
  EDGE: {
    token: '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
    /* 对齐 edge-tts（rany2，master）当前值：CHROMIUM_FULL_VERSION = 143.0.3650.75，前缀 "2-"。
       这是协议里**声明**的 Chromium build，不是本机浏览器版本；微软抬要求时跟着成熟库抬。 */
    secVer: '2-143.0.3650.75',
    wsBase: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
  },

  /* TTS 稳定性六件套（BF.tts.stab 消费），集中声明便于调参。 */
  TTS_STAB: {
    WATCHDOG_MS: 15000,        /* Chrome 15s 看门狗——连续无语音事件超 15s 触发复苏；配合逗号级分句（每句更短、onstart/onend 更频繁）避免慢速朗读误杀；有效事件重置轮次计数（连续无事件，非单次播放累计） */
    WD_ROUNDS: 2,              /* pause/resume 复苏两轮无效判停 */
    T1_RETRIES: 2,             /* T1 瞬时错误（网络抖动）重试 2 次 */
    T1_BACKOFF: [300, 1200],   /* T1 退避序列：300ms → 1.2s */
    T2_RETRIES: 1,             /* T2（5xx/429）重试 1 次，等待读 Retry-After */
    RETRY_AFTER_MAX: 30000,    /* Retry-After 等待上限 30s（再长受单句硬顶约束） */
    SEG_CAP_MS: 30000,         /* 30s 单句硬顶（含重试） */
    BUDGET_CAP: 8,             /* 单次播放重试预算上界（引擎切换不重置，不无限重试） */
    COOL_T1_MS: 1500,          /* 瞬时错误后引擎冷却去抖 */
    SKEW_MS: 300000,           /* 时钟偏差 >5min 判为 403 根因，调 skew 重试一次 */
    PROBE_TIMEOUT_MS: 5000,    /* 按需健康探针超时 */
    PROBE_STALE_MS: 60000,    /* 按需探针防抖：60s 内已探过不重复打 */
    PROBE_GATE_MS: 60000,     /* 探针「不可用」结论影响路由/三态灯的窗口（与防抖独立） */
    NOTI_GATE_MS: 30000,       /* 节流闸①：同类错误 30s 1 条 */
    TTL: { B: 900000, C: 900000, E: 60000, D: 300000 },   /* 黑表 TTL：B/C→900s、E→60s、D 超预算→300s（内存态不落存储） */
  },

  /* 睡眠定时步进（顶栏循环按钮与设置面板下拉共用此表）。
     两处必须引用同一份，否则不同入口看到的选项不一致；
     顶栏定时器的写入与朗读开始时读取的 BF.settings.get('ttsSleepMin') 同源，
     否则点顶栏定时器不会真的设置睡眠定时。 */
  TTS_SLEEP_STEPS: [0, 15, 30, 45, 60],

  /* 环境背景动画（BF.amb） */
  AMB_FPS_LOW: 40,        // 低于此帧率视为吃力
  AMB_CHECK_MS: 3000,     // 每 3 秒采样一次帧率

  /* 自包含包导出（BF.selfPackage） */
  SELFPKG_MAX_MB: 60,     // 正文体积上限；超出部分章节留空并在包内标记

  /* 错误与自愈（BF.err） */
  ERR_RING_MAX: 20,          // 最近异常环形缓冲长度
  ERR_HEAL_COOLDOWN: 120000, // 自动自愈冷却 2 分钟
  ERR_HEAL_RATE: 3,          // 60s 内 >=3 次异常才触发自愈
  ERR_HEAL_WINDOW: 60000,
  ERR_HEALTH_WINDOW: 600000, // 健康度长窗口 10 分钟
  ERR_HEALTH_RATE: 20,       // 10 分钟内 >20 次视为健康度异常
  ERR_HEALTH_COOLDOWN: 60000,// 健康度告警冷却 1 分钟

  /* Agent 模式：单次 agentRun 的 token 预算与工具重复调用上限——
     仅有 AGENT_MAX_LOOP 循环数兜底时，模型陷入长上下文自问自答会把配额烧光，
     用户只看到它「转圈」。
     超预算与环路都走「注入说明 → 再调一次取最终回答」的可解释终止，
     不是静默截断。 */
  AGENT_TOKEN_BUDGET: 20000,   // 单次 agentRun 累计 token 上限
  AGENT_REPEAT_LIMIT: 3,       // 同工具同参数连续调用上限

  /* Worker 池（BF.workerPool） */
  WORKER_TASK_TIMEOUT: 60000,   // 单任务超时 60s（压缩大文本较慢）
  WORKER_MAX_PENDING: 128,      // pending 上限，超出直接拒绝
  WORKER_TEXT_THRESHOLD: 128 * 1024, // >128KB 文本的压缩/解压移入 Worker

  /* 备份（BF.bk） */
  BACKUP_MAX: 5,             // OPFS 快照保留份数

  /* 通知（BF.noti） */
  NOTI_HIST_MAX: 100,        // 通知历史条数
  NOTI_VISIBLE_MAX: 5,       // 同屏可见通知上限，超出复用最早的

  /* AI（BF.ai） */
  AGENT_MAX_LOOP: 3,         // Agent 工具循环上限
  AGENT_ADVICE_MAX: 8,       // 单次设置建议弹窗最多列几条（超出的直接丢弃并告知模型）
  AGENT_ADVICE_TTL: 30000,   // 建议弹窗自动关闭毫秒数（无操作时自动按「拒绝」处理，不晾着）
  AI_SUMMARY_LEVEL_WORDS: { brief: 80, standard: 150, detail: 400 },
  /* AI 分章一次送出的正文上限（字符）。它是「模型看得见的量」，不是切分量：
     超出部分模型看不到，就不会给出那里的锚点，切分自然停在这里 ——
     截 12000 且只切第 0 章会把书静默砍成碎片。 */
  AI_SPLIT_SAMPLE_CAP: 60000,
  AI_CTX_SEG_LEN: 800,       // 每段上下文字数，AI 上下文总长 = 段数 × 此值

  /* 界面（BF.settingsUI） */
  SETTINGS_LAZY_FROM: 3,     // 设置面板前 N 节立即渲染，其余滚动到附近再建
  SETTINGS_SCROLL_PAD: 1,    // 懒加载预加载屏数（相对视口高度）
};

