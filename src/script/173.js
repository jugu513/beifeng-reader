/* ================= 内置手册 / 帮助中心 ================= */
BF.help = (function () {
  /* 快捷键表唯一实现：统一从 BF.hotkeys 注册表（热键 + 行为键）生成，
     反映真实绑定与用户自定义（改过的键位实时生效）——
     使用手册、? 速查面板、设置帮助三处各维护一份静态表
     会互相矛盾（条目缺漏、键位不一）。 */
  function shortcutsHTML() {
    const esc = function (s) { return BF.dom.esc(s); };
    const rows = [];
    const hks = (BF.hotkeys && typeof BF.hotkeys.list === 'function') ? BF.hotkeys.list() : [];
    for (let i = 0; i < hks.length; i++) {
      const h = hks[i];
      if (!h || !h.id || /\.mac$/.test(h.id)) continue;   /* Mac 别名与 Ctrl 版同功能，不重复列 */
      const combo = (BF.hotkeys && typeof BF.hotkeys.fmt === 'function') ? BF.hotkeys.fmt(h.combo) : h.combo;
      const label = (BF.hotkeys && BF.hotkeys.LABELS) ? (BF.hotkeys.LABELS[h.id] || h.id) : h.id;
      rows.push('<tr><td><kbd>' + esc(combo) + '</kbd></td><td>' + esc(label) + '</td></tr>');
    }
    const bk = (BF.hotkeys && typeof BF.hotkeys.behaviorKeys === 'function') ? BF.hotkeys.behaviorKeys() : [];
    for (let j = 0; j < bk.length; j++) {
      rows.push('<tr><td><kbd>' + esc(bk[j][1]) + '</kbd></td><td>' + esc(bk[j][2]) + '</td></tr>');
    }
    if (!rows.length) return '<div style="font-size:12px;color:var(--text-weak)">快捷键尚未绑定（启动时绑定，若为空请检查启动日志）</div>';
    return '<table class="help-tbl"><tbody>' + rows.join('') + '</tbody></table>';
  }
  function manualHTML() {
    return '<div class="help-body">' +
      '<p>阅读数据全部本地（IndexedDB + localStorage）；以下功能会联网并送出对应内容：AI（书名 + 取材段）、在线朗读（待读文本）、URL 导入、在线白噪音。其余功能不联网。</p>' +
      /* 诚实声明：AI 能力的密钥边界 —— 程序本体不带任何 API 密钥，
         密钥只存在本机设置里，导出/分享/上传设置或备份即等于交出密钥。
         手册是用户首次接触 AI 功能的入口，声明必须在此可见。 */
      '<p style="color:var(--warning-ink)">程序不含任何内置 API 密钥；AI 功能需你在「设置 → AI 服务」自行填写。密钥只存本机，导出设置或备份即等于交出密钥。</p>' +
      '<h4>核心功能</h4><ul>' +
      '<li><b>导入</b>：TXT 文件 / 剪贴板 / URL；支持自动分章与正则自定义分章。</li>' +
      '<li><b>阅读</b>：滚动 / 分页双模式；字号、行距、字距、页边距在「阅读设置面板」调（阅读器与设置同源），色温、阅读滤镜在设置→阅读调；场景预设直接套用。</li>' +
      '<li><b>标注</b>：书签、划线（下划线 / 波浪线 / 底色）、笔记、生词本，均存本地。</li>' +
      '<li><b>朗读</b>：Edge / MiMo / 浏览器三种引擎自动择优，一种不可用自动换下一种；断网自动重连、卡顿自动恢复；支持断点续播与单击段落朗读。</li>' +
      '<li><b>AI 研读</b>：问书、摘要、角色档案等（设置中配置 API 后可用）。</li>' +
      '<li><b>统计</b>：每日阅读时长、连续打卡、各书阅读时长。</li>' +
      '<li><b>导航历史</b>：自动记录阅读位置，可前进 / 后退。</li></ul>' +
      '<h4>工具与工作台</h4><ul>' +
      '<li><b>工具面板</b>（更多菜单「工具面板」或「番茄钟」）：番茄钟专注计时 + 环境音白噪音，两栏合一。</li>' +
      '<li><b>工作台</b>（顶栏 / 我的页入口，默认隐藏，可在「设置·界面方案·开发者工具」开启）：数据 / 日志 / 进程 / 诊断 / 统计 / 任务 / 通知七栏合一，左侧栏切换；统计栏含「今日专注」与阅读热力图。也可随时在 DSL 终端输入 wb.open 打开。</li>' +
      '<li><b>设置项直达</b>：设置面板顶部搜索框，输入设置项名即定位到对应分区并高亮。</li></ul>' +
      '<h4>数据安全</h4><ul>' +
      '<li>立即备份 / 导出备份 / 导入备份：全部数据打包为 JSON。</li>' +
      '<li>数据修复：自动体检并修复异常元数据。</li>' +
      '<li>清空缓存：仅清可重建的临时数据（AI 缓存、异常暂存记录等），不删书。</li>' +
      '<li>启动锁（PIN）：只锁界面，不加密存储，属防误触 / 防翻看，不是加密保护。忘了 PIN 就在锁屏点「忘记 PIN」，它会清除锁定并让你重新设置，<b>书籍与笔记数据不受影响</b>；连续输错会临时锁定几分钟。想真正保护内容，请用系统账户或磁盘加密。</li>' +
      '<li>删除自动备份：独立入口，<b>删除后无法找回</b>，清理前先导出备份。</li>' +
      '<li><b>密钥显示策略</b>：设置里的 API 密钥默认打码（只露尾四位）。点「显示」先确认一次才出原文，10 秒后自动收回；'
      + '可改成「直接显示」或「永不显示」（公共设备）。输入框旁「复制」取当前值，「清除」是不可找回的一步。</li>' +
      '<li><b>外部图片</b>：AI 回答与便签里的外部图片默认不自动加载，打开页面不向图片所在服务器发请求，点占位处才加载；想直接显示可在「设置 → 隐私与日志 → 外部图片」改。</li>' +
      '<li><b>损坏隔离区</b>（数据页）：某项数据被读坏时不静默丢弃 —— 原文留一份副本进这里，再把该项重置为默认值；'
      + '可整区导出（导出前已剥掉密钥类字段，文件本身仍可能含敏感内容，别外发）或逐条清除。</li></ul>' +
      '<h4>询问与确认</h4><ul>' +
      '<li>重要操作（删书、删除自动备份、恢复默认、恢复备份、重新分章、DSL 读写密钥等）执行前先询问，并列出将受影响的具体数据量（如「正文 128 段 · 划线 47 条 · 便签 6 条」）。</li>' +
      '<li>删书先进回收站：正文与标注原地保留，随时可恢复；回收站里的「彻底删除」与「清空」是不可找回的一步，必须敲 y。</li>' +
      '<li>询问分四档：常规操作不打扰；一般操作单击确认；危险操作后果确认（不提供「不再询问」）；密钥级须回复 y 放行。</li>' +
      '<li>默认取消（回车即取消）；同一会话内同类操作已确认则不再重复询问。</li></ul>' +
      '<h4>常见问题</h4><ul>' +
      '<li><b>书打不开？</b> 检查文件编码（解析设置可切 GBK/Big5）；超大文件请耐心等待解析。</li>' +
      '<li><b>朗读没声音？</b> 浏览器引擎需系统语音；Edge 引擎需以 Edge 打开；MiMo 需配置密钥。在线引擎故障会自动回落到下一级（最终落到浏览器语音），仍无声请检查系统语音包。</li>' +
      '<li><b>数据在哪？</b> 全部在本地，清除浏览器数据会一并删除，建议定期备份。</li></ul>' +
      '<h4>阅读设置</h4><ul>' +
      '<li><b>字号 / 行距 / 字距 / 页边距</b>：阅读器「字体」面板与设置→阅读→阅读设置面板（同一套）均可调，改完即生效；字号每本书独立记忆。</li>' +
      '<li><b>色温 / 阅读滤镜 / 场景预设</b>：设置→阅读，直接套用。</li>' +
      '<li><b>分页</b>：设置→阅读切换滚动 / 分页双模式，切换时保持阅读位置。</li>' +
      '<li><b>夜间自动</b>：设置中开启后 19:00–06:00 自动深色；手动切换主题会关闭本开关。</li>' +
      '<li><b>自动滚动</b>：阅读器更多菜单开启，按 a 键控制（空格是翻页）。</li></ul>' +
      '<h4>导出格式</h4><ul>' +
      '<li><b>标注（W3C JSON-LD）</b>：阅读器「更多」菜单「导出标注 (W3C JSON-LD)」，符合 W3C Annotation 规范；「导入标注 (W3C JSON-LD)」可回灌。</li>' +
      '<li><b>问书记录（Markdown / JSON）</b>：AI 研读中心导出，Markdown 供阅读，JSON 供程序处理。</li>' +
      '<li><b>生词（Anki TSV）</b>：生词页「导出」，或阅读器「更多」菜单「导出生词 (Anki TSV)」，单词与上下文两列，可直接导入 Anki。</li>' +
      '<li><b>本书笔记（Markdown）</b>：便签编辑器与阅读器菜单「导出本书笔记」。</li>' +
      '<li><b>书籍正文（TXT）</b>：书架书籍菜单「导出 TXT」。</li>' +
      '<li><b>备份（JSON）</b>：立即备份 / 导出备份打包全部数据，「导入备份」恢复。</li></ul>' +
      '<h4>统计说明</h4><ul>' +
      '<li><b>今日</b>：当天阅读计时累计分钟数（开书起计时，关书或切书结算）。</li>' +
      '<li><b>连续</b>：从今天（今天尚未读则从昨天）往前数，连续有阅读记录的天数。</li>' +
      '<li><b>各书时长</b>：每本书独立累计，工作台统计栏按书列出。</li>' +
      '<li><b>热力图</b>：每日总分钟数着色，点格子看当日明细（时长 / 标注数 / 读过书）。</li>' +
      '<li><b>今日专注</b>：番茄钟专注累计分钟，与阅读时长分开统计。</li></ul>' +
      '<h4>快捷键</h4>' + shortcutsHTML() +
      /* DSL 手册唯一实现是 ctx.tools.exportManual() 导出的 .md（顶栏「手册」按钮导出），
         「更新日志」是使用手册独立页签（BF.help.open('changelog')），
         此处仅保留「打开 DSL 终端」按钮。 */
      '<h4>DSL 手册</h4>' +
      '<div style="font-size:12px;color:var(--text-weak);line-height:1.7">DSL 完整文档（SAFE_BF / ctx / tools 清单）从 DSL 终端顶栏「手册」按钮导出为 .md 查看。<button class="btn btn-xs" data-help-goto-dsl style="margin-left:6px">打开 DSL 终端</button></div>' +
      '</div>';
  }
  function changelogHTML() {
    var blk = (BF.settingsUI && typeof BF.settingsUI.updateLogBlock === 'function') ? BF.settingsUI.updateLogBlock() : '';
    if (!blk) return '<div style="padding:16px;font-size:12px;color:var(--text-weak)">更新日志暂不可用</div>';
    return '<div class="help-changelog">' + blk + '</div>';
  }
  var _helpTab = 'manual';
  var _helpTabBound = false;
  function helpRenderBody() {
    var panel = document.getElementById('help-panel');
    if (!panel) return;
    var body = panel.querySelector('.help-content');
    if (!body) return;
    body.innerHTML = (_helpTab === 'changelog') ? changelogHTML() : manualHTML();
    var tabs = panel.querySelectorAll('[data-help-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-help-tab') === _helpTab ? 'true' : 'false');
    }
  }
  function ensure() {
    /* 骨架统一由 BF._panel 工厂生成；标题元素
       保留 #help-title（open / 切页签时改标题文案用），
       close 按钮带 data-panel-close 走文档级委托。 */
    const p = BF._panel('help-panel', '', {
      cls: 'dlg-shell', cssText: '--dlg-w:min(680px,92vw);--dlg-maxh:82vh',   /* 使用手册：唯一 92vw / 82vh 的一对 */
      headCss: 'flex:0 0 auto;display:flex;align-items:center;gap:12px;padding-right:8px',
      headHTML: '<span class="pk-panel__title" id="help-title" style="font-size:14px">使用手册</span>' +
                '<div class="help-tabs" id="help-tabs" role="tablist" aria-label="帮助页签">' +
                  '<button type="button" class="help-tab" data-help-tab="manual" role="tab" aria-selected="false">使用手册</button>' +
                  '<button type="button" class="help-tab" data-help-tab="changelog" role="tab" aria-selected="false">更新日志</button>' +
                '</div>',
      bodyCls: 'help-content',
      bodyCss: 'overflow:auto;padding-top:0',
    });
    return p.el;
  }
  function open(tab) {
    _helpTab = (tab === 'changelog') ? 'changelog' : 'manual';
    const el = ensure();
    BF.sheet.open('help-panel', { sec: _helpTab, render: function () {
      const t = el.querySelector('#help-title');
      if (t) t.textContent = (_helpTab === 'changelog') ? '更新日志' : '使用手册';
      helpRenderBody();
    } });
  }
  if (!_helpTabBound) {
    _helpTabBound = true;
    document.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('[data-help-tab]') : null;
      if (!btn) return;
      const tab = btn.getAttribute('data-help-tab');
      if (tab === _helpTab) return;
      _helpTab = tab;
      const t = document.getElementById('help-title');
      if (t) t.textContent = (tab === 'changelog') ? '更新日志' : '使用手册';
      helpRenderBody();
    });
  }
  /* 顶栏「手册」按钮再点一次收起；正看着更新日志那页时收起的也是它，
     看着手册那页点它是换页（open('changelog') 的导航语义照旧）。 */
  function toggle(tab) {
    const t = (tab === 'changelog') ? 'changelog' : 'manual';
    if (BF.sheet.closable('help-panel', t)) { BF.sheet.close('help-panel'); return false; }
    open(tab); return true;   /* 骨架由 ensure() 现场生成 */
  }
  return { open: open, toggle: toggle };
})();

