/* ================= 0. 版本与常量 ================= */
BF.version = '0.0.1-alpha';
BF.VERSION_DISPLAY = 'V0.0.1-alpha';

/* 事件常量表（唯一实现，禁止裸字符串事件名） */
BF.EVENTS = {
  SETTINGS: 'settings:changed',
  THEME: 'theme:changed',
  BOOKSHELF: 'bookshelf:changed',
  STATE: 'state:change',
  IDB_UP: 'idb:up',
  IDB_DOWN: 'idb:down',
  NOTI: 'noti:new',
  /* 事件总线扩面：写操作完成时 emit，让「标注中心 / AI 上下文刷新 /
     多标签同步」从「改 N 个调用点」统一为「加一个订阅者」。命名即语义，
     与 BF.sync 的广播集合一一对应。 */
  ANNOTATION: 'annotation:change',
  READING_STATE: 'reading-state:change',
  PROGRESS: 'progress:change',
  BOOK_ADDED: 'book:added',
  BOOK_DELETED: 'book:deleted',
  IMPORT_DONE: 'import:done',
  EXPORT_DONE: 'export:done',
  TTS: 'tts:change',
  AI_CONTEXT: 'ai:context',
  SEARCH: 'search:change',
  SYNC_REMOTE: 'sync:remote',        /* 来自其他标签页（BF.sync 转发），本地不再回环广播 */
  STORAGE_QUOTA: 'storage:quota',     /* 配额水位变化（含 block 级阻断信号） */
};

