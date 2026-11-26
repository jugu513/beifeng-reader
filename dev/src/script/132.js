/* ================= 命令注册 ================= */
(function () {
  BF.commands.register({ id: 'nav.home', label: '回到首页', keywords: 'home 首页 主页', cat: '导航', run: function () { BF.app.go('home'); } });
  BF.commands.register({ id: 'nav.shelf', label: '进入书架', keywords: 'shelf 书架 书库', cat: '导航', run: function () { BF.app.go('bookshelf'); } });
  BF.commands.register({ id: 'nav.settings', label: '打开设置', keywords: 'settings 设置 偏好', cat: '导航', run: function () { BF.settingsUI.open(); } });
  BF.commands.register({ id: 'data.backend', label: '切换存储后端（自动/原层/新层）', keywords: 'storage 存储 后端 backend opfs 双写 落点', cat: '数据', run: function () {
    var mode = (BF.store && BF.store.backendMode) ? BF.store.backendMode() : 'auto';
    var next = mode === 'auto' ? 'legacy' : (mode === 'legacy' ? 'next' : 'auto');
    try { if (BF.settings && BF.settings.set) BF.settings.set('storageBackend', next); } catch (e) {}
    var m = (BF.store && BF.store.selectBackend) ? BF.store.selectBackend() : 'legacy';
    try { BF.noti.info('存储后端已切换：' + m + (m === 'next' ? (BF.fsync && BF.fsync.available ? '（OPFS 可用）' : '（OPFS 不可用·降级 IDB）') : '（原层 LS）')); } catch (e) {}
  } });
  BF.commands.register({ id: 'nav.notes', label: '打开便签', keywords: 'notes 便签 记事 本子 note 编辑器', cat: '导航', run: function () { BF.notes.open(); } });
  BF.commands.register({ id: 'read.continue', label: '继续上次阅读', keywords: 'continue 继续 上次 续读', cat: '阅读', run: function () { BF.app.continueRead(); } });
  BF.commands.register({ id: 'read.prev', label: '上一章', keywords: 'prev 上一章 后退', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.prevChapter(); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.next', label: '下一章', keywords: 'next 下一章 前进', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.nextChapter(); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.search', label: '全书搜索', keywords: 'search 搜索 查找 检索', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.openDrawer('search'); } });
  BF.commands.register({ id: 'read.bookmark', label: '添加书签', keywords: 'bookmark 书签', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.addBookmark(); } });
  BF.commands.register({ id: 'theme.cycle', label: '切换主题', keywords: 'theme 主题 换肤', cat: '外观', run: function () { BF.theme.cycle(); } });
  BF.commands.register({ id: 'tts.start', label: '开始朗读', keywords: 'tts 朗读 语音', cat: '朗读', run: function () { BF.tts.start(); } });
  BF.commands.register({ id: 'tts.stop', label: '停止朗读', keywords: 'tts 停止 朗读', cat: '朗读', run: function () { BF.tts.stop(); } });
  /* 备份是纯增量（只追加新快照），无可撤对象 ——
     不传 undo；失败人话化反馈走通道。 */
  BF.commands.register({ id: 'data.autobackup', label: '立即备份', keywords: 'backup 备份 快照', cat: '数据', run: function () { BF.act.run('立即备份', function () { if (BF.base) { BF.base.action('backup'); return; } if (BF.bk) return BF.bk.autoNow(); BF.noti.warn('备份功能未就绪'); }); } });
  BF.commands.register({ id: 'dev.console', label: 'DSL 终端', keywords: 'console 控制台 终端 DSL 终端 脚本', cat: '工具', run: function () { BF.dslUI.toggle(); } });
  BF.commands.register({ id: 'ws.focus', label: '番茄钟', keywords: 'focus 番茄 专注', cat: '工具', run: function () { BF.wsUI.toggleFocus(); } });
  BF.commands.register({ id: 'ws.noise', label: '白噪音', keywords: 'noise 白噪音 环境音', cat: '工具', run: function () { BF.wsUI.toggleNoise(); } });
  BF.commands.register({ id: 'stats.open', label: '阅读统计', keywords: 'stats 统计 热力图', cat: '工具', run: function () { BF.wsUI.toggleStats(); } });
  BF.commands.register({ id: 'noti.center', label: '通知中心', keywords: 'noti 通知 消息', cat: '工具', run: function () { BF.wsUI.openNotiCenter(); } });
  /* 工具 / 工作台各栏入口补全：除番茄钟 / 白噪音 / 阅读统计 /
     通知中心等单点命令外，还要有工作台面板总入口与
     七个栏、工具面板总入口、跨书搜索、提示词
     预设、设置「更新日志」节，保证这些都能被搜到。 */
  BF.commands.register({ id: 'wb.open', label: '工作台', keywords: 'workbench 工作台 数据 运维 统计 任务 通知', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open(); } });
  BF.commands.register({ id: 'wb.data', label: '工作台：数据', keywords: 'workbench 数据 备份 基地 存储 环境 快照', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('data'); } });
  BF.commands.register({ id: 'wb.logs', label: '工作台：日志', keywords: 'workbench 日志 log 运行时', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('logs'); } });
  BF.commands.register({ id: 'wb.runtime', label: '工作台：进程', keywords: 'workbench 进程 运行时 runtime worker 能力', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('runtime'); } });
  BF.commands.register({ id: 'wb.diag', label: '工作台：诊断', keywords: 'workbench 诊断 运维台 概览 存储 工具 修复', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('diag'); } });
  BF.commands.register({ id: 'wb.stats', label: '工作台：统计', keywords: 'workbench 统计 热力图 阅读 时长', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('stats'); } });
  BF.commands.register({ id: 'wb.tasks', label: '工作台：任务', keywords: 'workbench 任务 后台 进度 取消', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('tasks'); } });
  BF.commands.register({ id: 'wb.noti', label: '工作台：通知', keywords: 'workbench 通知 消息 历史', cat: '工具', run: function () { if (BF.workbench) BF.workbench.open('noti'); } });
  BF.commands.register({ id: 'tools.open', label: '工具面板', keywords: 'tools 工具 番茄钟 白噪音 专注 环境音', cat: '工具', run: function () { if (BF.tools) BF.tools.open(); } });
  BF.commands.register({ id: 'across.open', label: '跨书搜索', keywords: 'across 跨书 搜索 正文 全文 检索', cat: '阅读', run: function () { BF.library.openAcrossSearch(); } });
  BF.commands.register({ id: 'ai.prompts', label: '提示词预设', keywords: 'ai prompt 提示词 预设 编辑', cat: 'AI', run: function () { if (BF.ai && BF.ai.promptEditor) BF.ai.promptEditor.open(); } });
  BF.commands.register({ id: 'help.changelog', label: '使用手册 · 更新日志', keywords: '更新日志 changelog 版本 手册 使用手册', cat: '帮助', run: function () { if (BF.help) BF.help.open('changelog'); } });
  /* 运维台入口（BF.diag）：本条关键词不含「基地」——两个面板职责分家、
     各有各的入口，挂了会让搜「基地」误开到运维台。 */
  BF.commands.register({ id: 'diag.open', label: '打开运维台', keywords: '运维台 diag 日志 错误 异常 健康度 修复 自愈 运行时 进程 worker 任务 模块', cat: '数据', run: function () { BF.diag && BF.diag.open(); } });
  BF.commands.register({ id: 'workshop.make', label: '文本制作书籍', keywords: 'workshop 工坊 制作 文本 新建书', cat: '数据', run: function () { BF.workshop && BF.workshop.open(); } });
  BF.commands.register({ id: 'workshop.author', label: '批量设置作者', keywords: 'workshop 工坊 批量 作者', cat: '数据', run: function () { BF.workshop && BF.workshop.batchAuthor(); } });
  /* base.open 的关键词里不挂「日志」：基地面板不承担日志职责，
     挂了会让搜「日志」误命中「打开基地」。 */
  BF.commands.register({ id: 'base.open', label: '打开基地', keywords: 'base 基地 数据 统计 备份 存储 占用 快照 总字数 导出 导入 加密 环境', cat: '数据', run: function () { BF.base && BF.base.open(); } });
  BF.commands.register({ id: 'base.backup', label: '基地：立即备份', keywords: 'backup 备份 快照 立即 保存数据', cat: '数据', run: function () { if (BF.base) BF.base.action('backup'); } });
  BF.commands.register({ id: 'base.export', label: '基地：导出备份', keywords: 'export 导出 下载 备份 加密 json', cat: '数据', run: function () { if (BF.base) BF.base.action('export'); } });

  /* ============ 命令全量：导航/阅读/外观/数据/工具/导入/帮助 ============ */
  /* 所有 run 均调用真实 API（BF.store.clearTransients /
     clearBackups 已在 BF.store 定义，顺序无关）；
     BF.help 只在注册时声明，运行时才调用 */
  // 导航 / 帮助
  BF.commands.register({ id: 'nav.help', label: '打开帮助手册', keywords: 'help 帮助 手册 说明', cat: '帮助', run: function () { BF.help && BF.help.open(); } });
  BF.commands.register({ id: 'help.shortcuts', label: '快捷键列表', keywords: 'shortcut 快捷键 热键', cat: '帮助', run: function () { BF.help && BF.help.open('shortcuts'); } });
  BF.commands.register({ id: 'sys.about', label: '关于北风', keywords: 'about 关于 版本', cat: '帮助', run: function () { BF.noti.info('北风 V' + (BF.version || '') + ' · 本地阅读'); } });
  // 阅读
  BF.commands.register({ id: 'read.toc', label: '打开目录', keywords: 'toc 目录 章节', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.openDrawer('toc'); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.microread', label: '微读排版', keywords: 'microread 微读 排版', cat: '阅读', run: function () { if (BF.appState.currentPage === 'reader') BF.reader.toggleMicroread(); } });
  BF.commands.register({ id: 'read.closeDrawer', label: '关闭抽屉', keywords: 'drawer 抽屉 关闭', cat: '阅读', run: function () { BF.reader.closeDrawer(); } });
  BF.commands.register({ id: 'read.first', label: '跳到第一章', keywords: 'first 第一 开头', cat: '阅读', run: function () { if (BF.appState.currentBookId) BF.reader.gotoChapter(0); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.last', label: '跳到最后一章', keywords: 'last 最后 末尾', cat: '阅读', run: function () { const b = BF.store.lsGetArray(BF.store.K.BOOKS_META, []).find(function (x) { return x.id === BF.appState.currentBookId; }); if (b && b.totalChapters) BF.reader.gotoChapter(b.totalChapters - 1); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.goto', label: '跳转到指定章节', keywords: 'goto 跳章 章节号', cat: '阅读', run: async function () {
    if (!BF.appState.currentBookId) { BF.noti.warn('请先打开一本书'); return; }
    const n = parseInt(await BF.modal.prompt('跳转到第几章？', '输入章节序号（从 1 开始）'), 10);
    if (n >= 1) BF.reader.gotoChapter(n - 1);
  } });
  BF.commands.register({ id: 'read.export', label: '导出当前书', keywords: 'export 导出 下载 当前', cat: '数据', run: function () { if (BF.appState.currentBookId) BF.library.downloadBook(BF.appState.currentBookId); else BF.noti.warn('请先打开一本书'); } });
  BF.commands.register({ id: 'read.remain', label: '查看本章剩余', keywords: 'remain 剩余 进度 时间', cat: '阅读', run: function () { if (!BF.appState.currentBookId) { BF.noti.warn('请先打开一本书'); return; } if (BF.reader.updateRemain) BF.reader.updateRemain(); BF.noti.info((document.getElementById('reader-remain') || {}).textContent || '本页无进度信息'); } });
  // 外观：字号/行距
  BF.commands.register({ id: 'read.fontUp', label: '增大字号', keywords: 'font 字号 大', cat: '外观', run: function () { const _b = BF.appState.currentBookId; const _cur = parseInt(BF.prefs.resolve(_b, 'fontSize', BF.settings.get('fontSize')), 10) || 16; const _nv = Math.min(40, _cur + 1); if (_b) BF.prefs.set(_b, 'fontSize', _nv); BF.settings.set('fontSize', _nv); BF.theme.apply(); } });  BF.commands.register({ id: 'read.fontDown', label: '减小字号', keywords: 'font 字号 小', cat: '外观', run: function () { const _b = BF.appState.currentBookId; const _cur = parseInt(BF.prefs.resolve(_b, 'fontSize', BF.settings.get('fontSize')), 10) || 16; const _nv = Math.max(10, _cur - 1); if (_b) BF.prefs.set(_b, 'fontSize', _nv); BF.settings.set('fontSize', _nv); BF.theme.apply(); } });
  BF.commands.register({ id: 'read.lhUp', label: '增大行距', keywords: 'lineheight 行距 大', cat: '外观', run: function () { BF.settings.set('lineHeight', Math.min(3, +(BF.settings.num('lineHeight', 1.9)) + 0.1).toFixed(2)); BF.theme.apply(); } });
  BF.commands.register({ id: 'read.lhDown', label: '减小行距', keywords: 'lineheight 行距 小', cat: '外观', run: function () { BF.settings.set('lineHeight', Math.max(1, +(BF.settings.num('lineHeight', 1.9)) - 0.1).toFixed(2)); BF.theme.apply(); } });
  // 外观：主题
  /* 外观直达命令：从登记表生成（名字只住一处）——明暗档与色板同列，
     无独立的 theme.* 档位（纸鸢档不存在）。 */
  BF.SKINS.forEach(function (k) {
    BF.commands.register({ id: 'appearance.' + k, label: '外观：' + BF.SKIN_LABELS[k] + (BF.SKIN_SUBS[k] ? ' · ' + BF.SKIN_SUBS[k] : ''), keywords: 'theme 外观 ' + k, cat: '外观', run: function () { BF.theme.set(k); } });
  });
  // 外观：场景预设
  BF.commands.register({ id: 'scene.immersive', label: '场景：沉浸阅读', keywords: 'scene 场景 沉浸', cat: '外观', run: function () { BF.scene.apply('沉浸阅读'); } });
  BF.commands.register({ id: 'scene.bgAnim', label: '切换背景氛围', keywords: 'bg 背景 氛围 动画 薄雾 极光 余烬 ambient', cat: '外观', run: function () { BF.amb.cycle(); } });
  BF.commands.register({ id: 'scene.night', label: '场景：深夜护眼', keywords: 'scene 场景 深夜 护眼', cat: '外观', run: function () { BF.scene.apply('深夜护眼'); } });
  BF.commands.register({ id: 'scene.paper', label: '场景：纸感浅色', keywords: 'scene 场景 纸感', cat: '外观', run: function () { BF.scene.apply('纸感浅色'); } });
  BF.commands.register({ id: 'scene.compact', label: '场景：紧凑速读', keywords: 'scene 场景 紧凑', cat: '外观', run: function () { BF.scene.apply('紧凑速读'); } });
  // 数据
  /* 「导出是否加密」必须先问：常规导出不询问就会静默出明文，
     用户以为加密了。askOnExport 开启时先问一次。
     刻意不用确认框：取消与 Esc 的语义会和「明文导出」混淆，
     误按 Esc 就导出明文。这里自建三态按钮，Esc 一律取消、不导出。
     注意：实现必须放在 BF.bk 主模块内部。BF.bk 是单次整体赋值
     （BF.bk = (function{...})），任何在此之外的 `BF.bk.x = ...`
     都会被后执行的主模块赋值整个抹掉——*/
  BF.commands.register({ id: 'data.export', label: '导出全部备份', keywords: 'export 备份 导出 json', cat: '数据', run: function () { BF.bk && BF.bk.exportWithAsk(); } });
  BF.commands.register({ id: 'data.exportSelfPkg', label: '导出自包含离线包', keywords: 'selfpkg 离线包 自包含 打包 分发 分享 offline', cat: '数据', run: function () { BF.selfPackage.export(); } });
  BF.commands.register({ id: 'data.exportEnc', label: '加密导出备份（口令）', keywords: 'encrypt 加密 导出 备份 口令', cat: '数据', run: async function () {
    if (!BF.bk || !BF.bk.hasCrypto || !BF.bk.hasCrypto()) { BF.noti.warn('当前环境不支持加密（需 https/localhost）'); return; }
    const p = await BF.modal.prompt('加密导出', '请输入备份口令（导入时需用同一口令解密；口令一旦丢失将无法恢复备份，请牢记）', { type: 'password' });
    if (p) await BF.bk.exportFull(p);
  } });
  /* data.import / clearCache / clearBackups / reset 不在这里手工注册——
     它们的中枢能力（H.register）在安装期就把同名 id 同步进了命令表，
     晚一步的重复注册会被「拒绝覆盖」守卫拦下、变成带 boot warn 的死码，
     还会把真正撞名的信号埋掉。反馈与实现都属于能力本身（见 hub 的
     data.clearCache / clearBackups）—— 命令视图只有中枢一个所有权人。 */
  // 工具
  BF.commands.register({ id: 'find.inpage', label: '页内查找', keywords: 'find 查找 搜索', cat: '工具', run: function () { BF.findInPage.open(); } });
  BF.commands.register({ id: 'tts.pause', label: '暂停朗读', keywords: 'tts 暂停', cat: '朗读', run: function () { BF.tts.pause(); } });
  BF.commands.register({ id: 'tts.resume', label: '继续朗读', keywords: 'tts 继续 续播', cat: '朗读', run: function () { BF.tts.resume(); } });
  // 导入
  /* 导入非破坏（不想要的书走书架删除进回收站），
     无可撤对象 —— 不传 undo；失败人话化反馈走通道。 */
  BF.commands.register({ id: 'import.txt', label: '导入文件', keywords: 'import 导入 txt 文件', cat: '导入', run: function () { BF.act.run('导入文件', function () { BF.library.pickAndImport(); }); } });
  BF.commands.register({ id: 'import.clipboard', label: '导入剪贴板', keywords: 'import 剪贴板 clipboard', cat: '导入', run: function () { BF.library.importClipboard(); } });
  BF.commands.register({ id: 'import.url', label: '导入链接', keywords: 'import url 网址', cat: '导入', run: function () { BF.library.promptImportURL(); } });
  /* 撤销入口常驻：撤销不能只有 toast 按钮一个
     出口，toast 过期（8 秒）后撤销能力就不可达。
     命令注册表入口与 Ctrl/⌘+Z 快捷键（hotkeys
     另注册）构成常驻入口；栈空时明示，不静默
     无响应。 */
  /* hint 是命令列表里的实时小字 —— 「还剩几步可撤」只有栈自己知道，
     写进 label 就是第二个事实源；做成函数每次渲染现取，与 run 用同一判据。 */
  BF.commands.register({ id: 'edit.undo', label: '撤销上一步', keywords: 'undo 撤销 回退 ctrl+z', cat: '工具',
    hint: function () { return BF.undo && BF.undo.count() ? '栈内 ' + BF.undo.count() + ' 步' : '栈已空'; },
    run: function () {
      if (!BF.undo || !BF.undo.count()) { BF.noti.info('暂无可撤销操作'); return; }
      BF.undo.undo();
    } });
})();

/* ============================================================
   北风 · settings 域：分区注册表 + 完整设置面板
   ============================================================ */
BF.settingsUI = BF.settingsUI || {};

