/* ===== AI 预设操作 ===== */
BF.settingsUI._refreshPresetSel = function () {
  const sel = document.getElementById('ai-preset-sel');
  if (!sel) return;
  const cur = sel.value;
  const presets = BF.settings.get('aiPresets') || {};
  sel.innerHTML = '<option value="">（无）</option>' + Object.keys(presets).map(function (n) {
    return '<option value="' + BF.dom.escAttr(n) + '">' + BF.dom.esc(n) + '</option>';
  }).join('');
  if (presets[cur]) sel.value = cur;
};
BF.settingsUI.applyPreset = function () {
  try {
    const sel = document.getElementById('ai-preset-sel');
    const name = sel ? sel.value : '';
    const presets = BF.settings.get('aiPresets') || {};
    const p = presets[name];
    if (!name || !p) { BF.noti.info('先选一个 AI 预设'); return; }
    const patch = {};
    (BF.settingsUI.AI_PRESET_KEYS || []).forEach(function (k) { if (k in p) patch[k] = p[k]; });
    /* 含密钥预设：aiApiKey 一并应用（与手动填密钥同一落点 BF.settings.set） */
    if (p.aiApiKey) patch.aiApiKey = p.aiApiKey;
    if (!Object.keys(patch).length) { BF.noti.info('该预设没有可应用的配置项'); return; }
    BF.settings.patch(patch);
    BF.noti.success('已应用预设：' + name);
    if (document.getElementById('ai-preset-sel')) BF.settingsUI.render();
  } catch (e) { BF.err.report('preset.apply', e); }
};
BF.settingsUI.savePreset = function () {
  try {
    BF.ask.prompt('预设名称', '').then(function (name) {
      name = (name || '').trim();
      if (!name) return;
      if ((BF.settings.get('aiPresets') || {})[name]) {
        /* 预设是密钥载体：同名覆盖会把原先引用的 API 密钥一起抹掉。
           danger 留字面 2（后果确认档），含密钥时再叠加 requireY
           —— 要用户亲手敲一个 y，不给顺手覆盖凭证的机会。 */
        const _presets = BF.settings.get('aiPresets') || {};
        const _hasKey = !!(_presets[name] && _presets[name].aiApiKey);
        return BF.ask.confirm({ title: '覆盖预设', body: '预设「' + name + '」已存在，它原有的配置会被替换（可撤销一次）。' + (_hasKey ? '<br/><b style="color:var(--danger)">该预设含 API 密钥，覆盖后旧密钥引用将丢失，需敲字确认。</b>' : ''), confirmText: '覆盖', danger: 2, requireY: _hasKey, op: 'settings.overwritePreset' }).then(function (ok) {
          if (!ok) return;
          _doSavePreset(name);
        });
      }
      _doSavePreset(name);
    }).catch(function () {});
  } catch (e) { BF.err.report('preset.save', e); }
};
function _doSavePreset(name) {
  try {
    const incKey = !!(document.getElementById('ai-preset-inckey') || {}).checked;
    const snap = {};
    (BF.settingsUI.AI_PRESET_KEYS || []).forEach(function (k) { snap[k] = BF.settings.get(k); });
    if (incKey) { const k = BF.settings.get('aiApiKey'); if (k) snap.aiApiKey = k; }
    const cur = BF.settings.get('aiPresets') || {};
    const prev = JSON.parse(JSON.stringify(cur));
    cur[name] = snap;
    /* 覆盖同名预设会抹掉原有配置，所以走唯一撤销通道留一条逆操作 */
    BF.act.run('保存预设：' + name, function () { BF.settings.set('aiPresets', cur); }, {
      undo: function () { BF.settings.set('aiPresets', prev); },
    });
    BF.noti.success('已保存预设：' + name + (incKey ? '（含密钥）' : ''));
    if (document.getElementById('ai-preset-sel')) BF.settingsUI._refreshPresetSel();
  } catch (e) { BF.err.report('preset.save.do', e); }
}
BF.settingsUI.delPreset = function () {
  try {
    const sel = document.getElementById('ai-preset-sel');
    const name = sel ? sel.value : '';
    if (!name) { BF.noti.info('先选一个要删除的预设'); return; }
    /* 与覆盖预设同一规则：danger 留字面 2（按档位挂号），
       预设里带密钥时追加 requireY，删除要敲字确认。 */
    const _p = (BF.settings.get('aiPresets') || {})[name];
    const _hasKey = !!(_p && _p.aiApiKey);
    BF.ask.confirm({ title: '删除预设', body: '确定删除预设「' + name + '」？该预设保存的配置' + (_hasKey ? '（含 API 密钥，删除后密钥引用将丢失，需敲字确认）' : '（含勾选过「含密钥」时的凭证引用）') + '会一并移除（可撤销一次）。', confirmText: '删除', danger: 2, requireY: _hasKey, op: 'settings.delPreset' }).then(function (ok) {
      if (!ok) return;
      const cur = BF.settings.get('aiPresets') || {};
      const prev = JSON.parse(JSON.stringify(cur));
      delete cur[name];
      /* 走唯一撤销通道：用户数据被销毁必须能回响（不做裸 push） */
      BF.act.run('删除预设：' + name, function () { BF.settings.set('aiPresets', cur); }, {
        undo: function () { BF.settings.set('aiPresets', prev); },
      });
      BF.noti.success('已删除预设：' + name);
      if (document.getElementById('ai-preset-sel')) BF.settingsUI._refreshPresetSel();
    });
  } catch (e) { BF.err.report('preset.del', e); }
};
BF.settingsUI.register('ai', 5, function () {
  const provSel = BF.ai.PROVIDERS.map(function (p) {
    return '<option value="' + p.id + '"' + (BF.settings.get('aiProvider') === p.id ? ' selected' : '') + '>' + p.name + (p.note ? '（' + p.note + '）' : '') + '</option>';
  }).join('');
  const key = BF.settings.get('aiApiKey') || '';
  /* 预设下拉：列出已存预设（含「无」占位）。预设对象存于 settings.aiPresets（KEPT_KEYS 已保）。 */
  const _presets = BF.settings.get('aiPresets') || {};
  const _presetOpts = '<option value="">（无）</option>' + Object.keys(_presets).map(function (n) {
    return '<option value="' + BF.dom.escAttr(n) + '">' + BF.dom.esc(n) + '</option>';
  }).join('');
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">AI 服务</h4>' +
    BF.settingsUI._sub('连接与端点',
      BF.settingsUI._row('AI 总开关', BF.settingsUI._sel('aiEnabled', [['true', '开启（默认）'], ['false', '停用（不发起任何请求）']])) +
      BF.settingsUI._row('服务商', '<select class="select" data-set="aiProvider" style="flex:1">' + provSel + '</select>') +
      /* 自定义端点这一行以前根本没有：选了「自定义」却没地方填地址，那条通道等于不存在。
         地址归一在 BF.ai.joinEndpoint，所以粘服务商文档里那条完整地址也能用。 */
      BF.settingsUI._row('自定义端点', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('aiEndpoint') || '') + '" class="input set-inp" data-set-text="aiEndpoint" placeholder="选「自定义」时填，例：https://api.xxx.com/v1"/>') +
      BF.settingsUI._row('传输方式', BF.settingsUI._sel('aiTransport', [['auto', '自动（能直连就直连，否则走本机转发）'], ['direct', '仅浏览器直连'], ['proxy', '始终走本机转发']])) +
      BF.settingsUI._row('本机转发地址', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('aiProxyBase') || '') + '" class="input set-inp" data-set-text="aiProxyBase" placeholder="http://127.0.0.1:8792"/>') +
      BF.settingsUI._row('API Key', '<input type="password" value="' + BF.dom.escAttr(key) + '" class="input" data-set-text="aiApiKey" style="flex:1" placeholder="sk-..."/>') +
      '<div class="pane-hint set-key-warn">密钥以明文存于浏览器本地存储；PIN 仅锁定界面、不加密存储。输入框默认打码，只显示尾 4 位；「显示」按下面的「密钥显示」策略露出原文，「复制」直接送进剪贴板，「清除」把这一项恢复成未设置。请勿在公共设备保存，并勿安装来路不明扩展。</div>' +
      BF.settingsUI._row('密钥显示', BF.settingsUI._sel('keyReveal', [['ask', '每次点「显示」问一句（默认）'], ['allow', '直接显示，10 秒后自动打码'], ['mask', '永不显示（公共设备）']])) +
      BF.settingsUI._row('模型', '<input type="text" list="ai-model-list" value="' + BF.dom.escAttr(BF.settings.get('aiModel') || '') + '" class="input" data-set-text="aiModel" style="flex:1" placeholder="默认取服务商推荐模型"/><datalist id="ai-model-list"></datalist><button class="btn btn-xs" data-ai-models>拉取模型</button><span class="pane-hint" id="ai-models-out"></span>') +
      /* AI 预设：命名配置快照。应用=把所选预设白名单键 patch 进 settings；另存为=抓当前配置存为命名预设
         （可勾选含密钥，默认不含，密钥走 aiApiKey 单独保留）；删除=移除所选预设。
         全部落 settings.aiPresets（已进 KEPT_KEYS，reset/导出均保留，且导出时密钥已被递归剥离）。 */
      BF.settingsUI._row('AI 预设', '<select class="select" id="ai-preset-sel" aria-label="AI 预设" style="flex:1">' + _presetOpts + '</select>' +
        ' <button class="btn btn-xs" data-preset-apply>应用</button>' +
        ' <button class="btn btn-xs" data-preset-save>另存为</button>' +
        ' <button class="btn btn-xs" data-preset-del>删除</button>' +
        ' <label><input type="checkbox" id="ai-preset-inckey"/> 含密钥</label>')
    ) +
    BF.settingsUI._sub('回复与检索',
      BF.settingsUI._row('回复结构', BF.settingsUI._sel('aiModelMode', [['auto', '自动（探测到支持才用工具调用）'], ['tools', '用工具调用'], ['plain', '纯文本 JSON']])) +
      BF.settingsUI._row('回复结构档', '<span class="ai-net" id="ai-tools-mode">' + BF.dom.esc('当前：' + BF.net.toolsMode() + '（' + ({ tools: '函数调用', plain: '纯文本 JSON', auto: '自动：未实测时按纯文本 JSON 兜底' }[BF.net.toolsMode()] || BF.net.toolsMode()) + '；能力未实测，点「探测各服务商」后见上方可达性结论）') + '</span>') +
      BF.settingsUI._row('网络可达性', '<span class="ai-net-btns"><button class="btn btn-xs" data-net-probe>探测各服务商</button> <button class="btn btn-xs" data-net-export>导出转发脚本（Node 版）</button> <button class="btn btn-xs" data-net-export-ps>导出转发脚本（免安装）</button></span><span class="ai-net" id="ai-net-state">' + BF.dom.esc(BF.net.statusText()) + '</span>') +
      BF.settingsUI._row('摘要详略', BF.settingsUI._sel('aiSummaryLevel', [['brief', '简短 80字'], ['standard', '标准 150字'], ['detail', '详细 400字']])) +
      BF.settingsUI._row('对话轮数', BF.settingsUI._sel('aiAskTurns', [['4', '4 轮'], ['6', '6 轮'], ['10', '10 轮']])) +
      BF.settingsUI._row('检索上下文段数', BF.settingsUI._sel('aiContextSegs', [['2', '2 段'], ['4', '4 段'], ['8', '8 段']])) +
      BF.settingsUI._row('参考当前书', BF.settingsUI._sel('aiRefBook', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('Agent 检索', BF.settingsUI._sel('aiAgent', [['true', '开启（问书先搜全书）'], ['false', '关闭（只用当前章）']])) +
      BF.settingsUI._row('提示词增强', BF.settingsUI._sel('aiPromptMode', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('搜索并发度', BF.settingsUI._sel('aiSearchPar', [['2', '2'], ['6', '6'], ['10', '10'], ['16', '16']])) +
      BF.settingsUI._row('提示词预设', '<button class="btn btn-xs" data-edit-prompts>编辑提示词…</button>')
    ) +
    BF.settingsUI._sub('稳定性与自动化',
      BF.settingsUI._row('并发数', BF.settingsUI._sel('aiConcurrency', [['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']])) +
      BF.settingsUI._row('重试次数', BF.settingsUI._sel('aiRetries', [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])) +
      /* 自动降级会用目标服务商的内置 key 把正文改道第三方，必须可拒绝。
         此处与降级通知里的「拒绝降级」按钮写同一个键（aiAutoDegrade）。 */
      BF.settingsUI._row('自动降级', BF.settingsUI._sel('aiAutoDegrade', [['true', '开启（服务商连续失败时自动切换其内置通道）'], ['false', '关闭（失败即提示，不把正文改道第三方）']])) +
      BF.settingsUI._row('自动切换', '<span style="font-size:12px;color:var(--text-dim)">服务商连续失败自动换一个 · 模型按成功率选择</span> <button class="btn btn-xs" data-smart-reset>重置选择记忆</button>') +
      BF.settingsUI._row('导入后 AI 增强', BF.settingsUI._sel('aiImportEnhance', [['true', '开启（导入自动生成摘要/标签）'], ['false', '关闭']])) +
      BF.settingsUI._row('AI 分章', BF.settingsUI._sel('aiAutoSplit', [['true', '开启（按情节切分章节）'], ['false', '关闭（用字数/正则）']])) +
      BF.settingsUI._row('AI 自动打标签', BF.settingsUI._sel('aiAutoTag', [['true', '开启（导入自动生成标签）'], ['false', '关闭']]))
    ) +
    BF.settingsUI._sub('目标与锁',
      BF.settingsUI._row('每日阅读目标（分钟，0=不设目标）', '<input type="number" min="0" max="600" value="' + BF.settings.num('readGoal', 30) + '" data-set-num="readGoal" style="flex:1"/>') +
      /* 目标是否纳入专注可配（默认关）。
         与「每日阅读目标」同区——二者共同决定
         「今日 X 分钟」的构成。 */
      BF.settingsUI._row('目标纳入专注', BF.settingsUI._sel('goalIncludeFocus', [['false', '关闭（专注不计入阅读目标）'], ['true', '开启（专注计入阅读目标）']])) +
      BF.settingsUI._row('启动锁（PIN）', '<span style="font-size:12px;color:var(--text-dim)">' + (BF.ai.store.pinLocked() ? '已启用（防误触 / 防翻看，不加密存储）' : '未设置') + '</span> <button class="btn btn-xs" data-pin-manage>' + (BF.ai.store.pinLocked() ? '修改/关闭' : '设置 PIN') + '</button>')
    ) +
    '</div>';
});
/* 存储面板：一张表逐区列「后端 / 条目 / 占用 / 可否迁移 / 承重」。
   每类一行下拉（非法项不列出＝置灰不可用）+ 迁移按钮；承重键只给镜像开关（主存恒 LS，C-2）。
   顶部：quotaLevel 三态横幅 + Agent 智能规划入口 + 自选根目录句柄（不支持则禁用并说明）。 */
BF.settingsUI._storageAllocHtml = function () {
  const st = BF.store;
  if (!st || !st.ALLOC_CANDIDATES) return '';
  const LABELS = { body: '正文', chapters: '章节缓存', audio: '朗读音频缓存', aiSummary: 'AI 摘要缓存', chunkIdx: '问书索引',
    bookmarks: '书签', highlights: '划线', notes: '便签', vocab: '生词', reading_state: '阅读进度', perbook_prefs: '随书偏好' };
  const MODE_LABELS = { auto: '自动（当前默认）', idb: 'IndexedDB', opfs: 'OPFS 文件', ls: '本地存储 LS' };
  const LEVEL = { ok: ['正常', 'var(--ok-color, #3a8)'], warn: ['偏高', 'var(--warning-ink, #c90)'], alert: ['告警', 'var(--warning-ink, #c90)'], block: ['阻断', 'var(--danger-ink, #d33)'] };
  let lv = 'ok'; try { lv = st.quotaLevel ? st.quotaLevel() : 'ok'; } catch (e) {}
  const lvInfo = LEVEL[lv] || LEVEL.ok;
  const cap = st.fsync && st.fsync.rootHandleSupported ? st.fsync.rootHandleSupported() : false;
  let html = '<div class="pane-hint bf-sp-tip">按类别选内容落点。切换后新写入落新区，旧数据仍可读；点「立即迁移」把旧区数据补到新区（不删旧）。承重键（书签/划线/便签/生词/进度/随书偏好）主存恒在本地存储、只能选是否额外留一份 IndexedDB 镜像。</div>';
  /* 三态横幅：统一走 quotaLevel，与写入闸门同一口径 */
  html += '<div data-sp-level class="bf-sp-banner">' +
    '<span class="bf-sp-dim">存储水位</span>' +
    '<b data-sp-level-label class="bf-sp-levelval" style="color:' + lvInfo[1] + '">' + lvInfo[0] + '</b>' +
    '<span class="bf-sp-fill"></span>' +
    '<button class="btn btn-xs" data-sp-plan title="让 Agent 依据设备与水位生成最优存储方案">让助手规划</button>' +
    '</div>';
  /* 表头：后端 / 条目 / 占用 / 可否迁移 / 承重 */
  html += '<div class="bf-sp-grid-h">' +
    '<span>内容类别</span><span>后端 / 设置</span><span>条目</span><span>占用</span><span>承重</span></div>';
  /* 表体：每类一行（data-alloc / data-alloc-usage / data-alloc-migrate / data-mirror） */
  html += '<div data-sp-rows>';
  (st.ALLOC_CATEGORIES || []).forEach(function (cat) {
    const opts = (st.ALLOC_CANDIDATES[cat] || []).map(function (m) {
      const cur = st.allocOf(cat) === m;
      return '<option value="' + BF.dom.escAttr(m) + '"' + (cur ? ' selected' : '') + '>' + (MODE_LABELS[m] || m) + '</option>';
    }).join('');
    html += '<div class="bf-sp-grid">' +
      '<span class="bf-sp-cat">' + (LABELS[cat] || cat) + '</span>' +
      '<span class="bf-sp-selcell"><select class="select bf-sp-sel" data-alloc="' + BF.dom.escAttr(cat) + '">' + opts + '</select>' +
      (cat === 'body' ? '<button class="btn btn-xs" data-alloc-migrate="' + BF.dom.escAttr(cat) + '" title="把旧区正文补到新区（不删旧）">迁</button>' : '') + '</span>' +
      '<span class="pane-hint bf-sp-num" data-sp-count="' + BF.dom.escAttr(cat) + '">—</span>' +
      '<span class="pane-hint bf-sp-num" data-alloc-usage="' + BF.dom.escAttr(cat) + '">…</span>' +
      '<span class="bf-sp-center">否</span></div>';
  });
  (st.MIRROR_CATEGORIES || []).forEach(function (cat) {
    const on = st.mirrorOf(cat);
    html += '<div class="bf-sp-grid">' +
      '<span class="bf-sp-cat">' + (LABELS[cat] || cat) + '</span>' +
      '<select class="select bf-sp-sel" data-mirror="' + BF.dom.escAttr(cat) + '">' +
      '<option value="true"' + (on ? ' selected' : '') + '>留镜像</option>' +
      '<option value="false"' + (!on ? ' selected' : '') + '>不留镜像</option></select>' +
      '<span class="bf-sp-right">—</span>' +
      '<span class="bf-sp-right">—</span>' +
      '<span class="bf-sp-yes">是</span></div>';
  });
  html += '</div>';
  /* 根目录句柄：支持则给「选择存储位置 / 恢复内置」，不支持则禁用并如实说明 */
  html += '<div class="bf-sp-root">' +
    '<span class="bf-sp-dim">存储位置</span>' +
    '<button class="btn btn-xs" data-root-pick' + (cap ? '' : ' disabled title="当前浏览器不支持自选目录"') + '>选择根目录…</button>' +
    '<button class="btn btn-xs" data-root-clear' + (cap ? '' : ' disabled') + '>恢复内置</button>' +
    '<span class="pane-hint">' + (cap ? '可把存储位置改绑到你选的目录；旧数据不会自动搬迁。' : '当前浏览器不支持自选目录，仍用内置 OPFS（静默降级）。') + '</span>' +
    '</div>';
  return html;
};
/* 占用/条目数异步填充（估算值，不阻塞面板渲染）。 */
BF.settingsUI._fillAllocUsage = function () {
  const st = BF.store; if (!st || !st.usage) return;
  try {
    Promise.resolve(st.usage()).then(function (u) {
      const txt = (u && typeof u.pct === 'number') ? ('≈' + u.pct.toFixed(0) + '%') : '占用 —';
      document.querySelectorAll('[data-alloc-usage]').forEach(function (el) { el.textContent = txt; });
    }).catch(function () {});
  } catch (e) {}
};
/* 填充每区条目数（storagePanel 聚合，异步；拿不到显示「—」）。 */
BF.settingsUI._fillStoragePanel = function () {
  const st = BF.store; if (!st || !st.storagePanel) return;
  try {
    const p = st.storagePanel();
    (p.rows || []).forEach(function (r) {
      if (r.count == null && r.key && typeof st._catCountAsync === 'function') return; /* 预留 */
    });
    /* 逐类取数：仅正文/章节/摘要等可便宜拿到的类填真实值 */
    const cats = (st.ALLOC_CATEGORIES || []);
    cats.forEach(function (cat) {
      const el = document.querySelector('[data-sp-count="' + cat + '"]');
      if (!el) return;
      /* 用轻量路径：正文走书单数，其余保持「—」不编造 */
      let n = null;
      try {
        if (cat === 'body') { const m = st.lsGetArray ? st.lsGetArray(st.K.BOOKS_META, []) : []; n = Array.isArray(m) ? m.length : 0; }
      } catch (e) {}
      el.textContent = n == null ? '—' : String(n);
    });
  } catch (e) {}
};

BF.settingsUI.register('data', 6, function () {
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">数据</h4>' +
    BF.settingsUI._sub('备份与维护',
      BF.settingsUI._row('自动备份', BF.settingsUI._sel('autoBackup', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('工作区同步', BF.settingsUI._sel('wsSync', [['true', '开启（本地数据同步到 OPFS）'], ['false', '关闭']])) +
      '<div style="display:flex;gap:8px;padding:12px 0;flex-wrap:wrap">' +
      /* 备份相关按钮组：立即备份 / 导出 / 导入 / 打开基地 / 运维台 / 重置 / 清缓存。换行靠容器 flex-wrap。 */
      '<button class="btn btn-sm" data-backup-now>立即备份</button>' +
      '<button class="btn btn-sm" data-export-backup>导出备份</button>' +
      '<button class="btn btn-sm" data-import-backup>导入备份</button>' +
      /* 运维台入口：报错文案会让用户「到运维台查看日志」，
         这里必须有一扇门，否则那句话等于把用户指向虚空（搜「运维台」0 命中）。 */
      '<button class="btn btn-sm" data-open-base title="统计 · 备份管理 · 存储占用 · 环境诊断">打开基地</button>' +
      '<button class="btn btn-sm" data-open-diag title="运行日志 · 任务 · 环境检测">打开运维台</button>' +
      '<button class="btn btn-sm danger" data-reset-all>重置全部</button>' +
      '<button class="btn btn-sm" data-clear-cache>清空缓存</button>' +
      '<input type="file" id="backup-input" accept=".json" aria-label="选择要恢复的备份文件" style="display:none" data-backup-file="1" />' +
      '</div>'
    ) +
    BF.settingsUI._sub('高级工具',
      BF.settingsUI._row('工作台入口<br/><span class="taste-note">高级运维能力（统计 / 备份管理 / 存储 / 诊断 / 日志）。关闭只隐藏入口（我的页 / 顶栏），功能始终可用：DSL 终端输入 wb.open 即可打开。需要时开启，让入口常驻。</span>',
        BF.settingsUI._sel('devTools', [['false', '隐藏入口（默认）'], ['true', '显示入口']]))) +
    BF.settingsUI._sub('存储分配', BF.settingsUI._storageAllocHtml()) +
    BF.settingsUI._sub('会话与通知',
      BF.settingsUI._row('会话恢复', BF.settingsUI._sel('sessionRestore', [['true', '开启（启动恢复上次阅读）'], ['false', '关闭（按落地页设定）']])) +
      BF.settingsUI._row('再次回到时打开', BF.settingsUI._sel('returnPage', [['shelf', '书架（默认）'], ['home', '主页']])) +
      '<div class="bf-set-hint">会话恢复开启时优先回到上次阅读的书；关闭后按本项停在书架或主页。</div>' +
      BF.settingsUI._row('桌面通知', BF.settingsUI._sel('desktopNoti', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('免打扰', BF.settingsUI._sel('notiMute', [['false', '关闭（正常弹卡片）'], ['true', '开启（不弹卡片，历史与未读照记；故障级始终弹）']]))
    ) +
    BF.settingsUI._sub('隐私与日志',
      BF.settingsUI._row('导出时询问加密', BF.settingsUI._sel('askOnExport', [['true', '每次导出都问'], ['false', '直接导出（明文）']])) +
      BF.settingsUI._row('隐私模式', BF.settingsUI._sel('privacyMode', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('外部图片', BF.settingsUI._sel('remoteImg', [['false', '不自动加载（点一下再看）'], ['true', '直接加载']])) +
      BF.settingsUI._row('记录普通日志', BF.settingsUI._sel('captureLog', [['true', '开启'], ['false', '仅警告与错误']])) +
      BF.settingsUI._row('控制台输出', BF.settingsUI._sel('consoleEcho', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('日志保留天数', BF.settingsUI._sel('captureLogDays', [['1', '1 天'], ['3', '3 天'], ['7', '7 天'], ['30', '30 天']])) +
      BF.settingsUI._row('存储持久化', '<span style="font-size:12px;color:var(--text-dim)">' + (BF.store && BF.store.persistLabel ? BF.store.persistLabel() : '检测中…') + '</span>')
    ) +
    '</div>';
});
BF.settingsUI.register('help', 7, function () {
  /* 帮助区的快捷键摘要从 BF.hotkeys 注册表生成，与使用手册 / ? 速查同一来源：
     手写静态行会和真实键位漂移（空格是翻页、自动滚动是 a 键）。
     版本号读 BF.VERSION_DISPLAY，不在这里硬编码。 */
  const esc = function (s) { return BF.dom.esc(s); };
  const items = [];
  const hks = (BF.hotkeys && typeof BF.hotkeys.list === 'function') ? BF.hotkeys.list() : [];
  for (let i = 0; i < hks.length; i++) {
    const h = hks[i];
    if (!h || !h.id || /\.mac$/.test(h.id)) continue;
    const combo = (BF.hotkeys && typeof BF.hotkeys.fmt === 'function') ? BF.hotkeys.fmt(h.combo) : h.combo;
    const label = (BF.hotkeys && BF.hotkeys.LABELS) ? (BF.hotkeys.LABELS[h.id] || h.id) : h.id;
    items.push(combo + ' ' + label);
  }
  const bk = (BF.hotkeys && typeof BF.hotkeys.behaviorKeys === 'function') ? BF.hotkeys.behaviorKeys() : [];
  for (let j = 0; j < bk.length; j++) items.push(bk[j][1] + ' ' + bk[j][2]);
  return '<div class="settings-section"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">帮助</h4>' +
    '<div style="font-size:12px;color:var(--text-weak);line-height:1.9">' +
    '<p>北风 ' + esc(BF.VERSION_DISPLAY || '') + ' · 本地阅读</p>' +
    '<p style="color:var(--accent-ink)">下方是全部快捷键；常用键速查见「使用手册 → 快捷键」，按 ? 也可随时呼出。</p>' +
    /* 快捷键数据为空时显示降级提示，不渲染「快捷键：」空行——
       与 shortcutsHTML 的降级行为保持一致。 */
    (items.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px">' +
        items.map(function (it) { return '<kbd>' + esc(it) + '</kbd>'; }).join('') +
        '</div>'
      : '<p style="color:var(--text-weak)">快捷键尚未绑定（启动时绑定，若为空请检查启动日志）</p>') +
    '<p>DSL 终端内：Ctrl/Cmd+Enter 运行 · Ctrl/Cmd+S 保存 · Esc 关闭</p>' +
    '<div style="padding:10px 0"><button class="btn btn-sm" data-open-help>打开使用手册</button></div>' +
    '</div></div>';
});
/* 「再看一次引导」入口——用户主动清除 K.ONBOARDED（不需 danger 确认），
   清除后重新展示首启浮条。与 dismiss 落盘失败同样要出声。 */
BF.settingsUI.register('onboard', 7.5, function () {
  const done = (function () { try { return !!BF.store.lsGet(BF.store.K.ONBOARDED, false); } catch (e) { return false; } })();
  return '<div class="settings-section onboard-sec"><h4>首启引导</h4>' +
    '<p>' + (done ? '首启引导已收起（点过「不再显示」，或导入第一本书后自动收起）。' : '首启引导浮条正在展示中。') + '</p>' +
    '<div class="row"><button class="btn btn-sm" data-onboard-reset>再看一次引导</button></div>' +
    '</div>';
});
