/* ================= 15. 首页 ================= */
BF.QUOTES = [
  { text: '读书破万卷，下笔如有神。', source: '杜甫' },
  { text: '书籍是人类进步的阶梯。', source: '高尔基' },
  { text: '读一本好书，就是和许多高尚的人谈话。', source: '歌德' },
  { text: '书山有路勤为径，学海无涯苦作舟。', source: '韩愈' },
  { text: '为中华之崛起而读书。', source: '周恩来' },
  { text: '不读书的人，思想就会停止。', source: '狄德罗' },
  { text: '腹有诗书气自华。', source: '苏轼' },
  { text: '书籍是造就灵魂的工具。', source: '雨果' },
  { text: '读万卷书，行万里路。', source: '董其昌' },
  { text: '学而不思则罔，思而不学则殆。', source: '孔子' },
  { text: '一日不读书，胸臆无佳想。', source: '萧抡谓' },
  { text: '书籍是屹立在时间的汪洋大海中的灯塔。', source: '惠普尔' },
  { text: '读书之法，在循序而渐进，熟读而精思。', source: '朱熹' },
  { text: '立身以立学为先，立学以读书为本。', source: '欧阳修' },
  { text: '好书是伟大心灵的富贵血脉。', source: '弥尔顿' },
];
let _te = null;   /* TextEncoder 单例：byteLen 在 sanitize 热路径上每次调用 */
BF.util = {
  titleHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
  },
  coverHue(str) {
    let h = 0;
    const s = String(str == null ? '' : str);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 6;
  },
  hashColor(str) {
    return 'var(--bf-cover-' + BF.util.coverHue(str) + ')';
  },
  /* 渲染后把 data-w / data-h 落成宽高：进度与柱状的数值只住在 data-* 里一份，
     模板字符串不写内联 style（写了就是同一事实的第二副本，且内联样式有上限）。 */
  applyDataGeom(root) {
    if (!root || !root.querySelectorAll) return;
    const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
    root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = clamp(el.getAttribute('data-w')) + '%'; });
    root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = clamp(el.getAttribute('data-h')) + '%'; });
  },
  /* 千分位数字 */
  fmtNum(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : n.toLocaleString('zh-CN');
  },
  /* 字节体积：缺值给「—」而不是 0 B（0 B 会被读成「真的是空文件」） */
  fmtBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  },
  /* UTF-8 字节数：书籍体积的统一口径（file.size / buf.byteLength 同义）。
     无 File 对象的通道（剪贴板、文本制作）若拿 String.length 当体积，
     中文会被低估约三倍，且与判重里的字节阈值对不上。 */
  byteLen(s) {
    s = String(s == null ? '' : s);
    try { return (_te || (_te = new TextEncoder())).encode(s).length; } catch (e) { return s.length * 3; }
  },
  /* 相对时间 */
  timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    /* 未来时间（时钟偏差/数据异常）不误报「刚刚」，给绝对时间 */
    if (diff < 0) return new Date(ts).toLocaleDateString('zh-CN');
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 7) return d + ' 天前';
    return new Date(ts).toLocaleDateString('zh-CN');
  },
  /* 书封式封面底色 + 墨色（主题感知） */
  coverArt(title) {
    const bg = 'var(--bf-cover-' + BF.util.coverHue(title) + ')';
    const isLight = document.body.classList.contains('light');
    const ink = isLight ? 'rgba(255,252,246,.86)' : 'rgba(240,236,230,.82)';
    return 'background:' + bg + ';--pv-ink:' + ink;
  },
};
/* 「最近在读」横排卡（首页 + 书架页共用）：两处渲染点共用本函数，封面走
   BF.util.coverArt 同一套令牌（竖排书名 + 左下印章），与书架书封同血统，
   不用纯色块 + 横排居中小字的另一种画法。 */
BF.app.recentCardHTML = function (b) {
  const t = b.title || '';
  /* 最近在读的横条也给一条进度环：和书架卡同一份读数，不在两处各算一遍。
     读数口径与 _shelfCardHTML 共用 recFor（老数据镜像退回也一致）。 */
  const _p = Math.round(BF.reader.bookFrac(b, BF.reader.recFor(b, BF.store.lsGetMemo(BF.store.K.READING_STATE, {}) || {})) * 100);
  return '<div class="book-card" style="cursor:pointer" data-open-book="' + BF.dom.escAttr(b.id) + '">' +
    '<div class="cover cover-art" style="' + BF.util.coverArt(t) + '">' +
    '<span class="seal" aria-hidden="true">' + BF.dom.esc(t.charAt(0) || '?') + '</span>' +
    '<span class="vtitle" aria-hidden="true">' + BF.dom.esc(t.slice(0, 8)) + '</span>' +
    (_p > 0 ? '<span class="shelf-ring" aria-hidden="true"><svg viewBox="0 0 32 32"><circle class="ring-bg" cx="16" cy="16" r="13"></circle><circle class="ring-fg" cx="16" cy="16" r="13" stroke-dasharray="' + (81.68 * _p / 100).toFixed(1) + ' 81.7"></circle></svg></span>' : '') +
    '</div>' +
    '<div class="meta"><div class="title" title="' + BF.dom.esc(t) + '">' + BF.dom.esc(t) + '</div></div>' +
    '</div>';
};
/* 告警文本按两个环境事实生成，判据与 DOM 分开：
   浏览器里改不动 location.protocol，把纯函数分出来才能真机验证 file:// 那一支真的会出字。 */
BF.app.envWarnText = function (isFile, noIdb) {
  if (!isFile && !noIdb) return '';
  const msg = [];
  if (isFile) msg.push('现在是用浏览器直接打开这个文件（file://）：这种打开方式用不了朗读引擎的在线语音，阅读进度与设置只存在浏览器临时区，可能隔天就清掉；而且本机任何网页文件都能读到这些数据和密钥，别把唯一一份存这儿。');
  if (noIdb) msg.push('这台浏览器没有提供本地数据库（IndexedDB），章节正文只能落在更小的一层里。');
  msg.push('要长期用，请把这个文件放进一个本地目录，用本地服务（http://127.0.0.1:…）打开。');
  return msg.join(' ');
};
BF.app.updateEnvWarn = function () {
  const el = document.getElementById('env-warn');
  if (!el) return;
  /* file:// 下浏览器不给 OPFS / Web Crypto，在线朗读引擎也用不了：朗读会退回本地语音，
     数据只剩 localStorage 一层且随时可能被清。
     这条常驻、不给关闭按钮——一次「不再提示」就把「进度为什么隔天没了」
     变成用户自己去猜的事。 */
  const t = BF.app.envWarnText(location.protocol === 'file:', !('indexedDB' in window));
  if (!t) { el.hidden = true; return; }
  el.textContent = t;
  el.hidden = false;
};
BF.app.renderHome = function () {
  BF.app.updateEnvWarn();
  const books = BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, []));
  const recent = books.filter(b => b && b.lastRead).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0)).slice(0, 8);
  const rc = document.getElementById('recent-scroll');
  if (rc) {
    if (!recent.length) {
      rc.innerHTML = '<div class="recent-empty">还没有阅读记录。读过的书会按最近阅读排在这里<button class="btn btn-xs" data-trigger-import>导入书籍</button></div>';
    } else {
      rc.innerHTML = recent.map(BF.app.recentCardHTML).join('');
    }
  }
  const dq = document.getElementById('daily-quote');
  if (dq) {
    const day = Math.floor(Date.now() / 86400000);
    const q = BF.QUOTES[day % BF.QUOTES.length];
    dq.innerHTML = '“' + BF.dom.esc(q.text) + '”<div class="source">—— ' + BF.dom.esc(q.source) + '</div>';
  }
  const hs = document.getElementById('home-stats');
  if (hs) {
    const daily = BF.store.lsGet(BF.store.K.DAILY, {});
    const todayKey = BF.stats ? BF.stats.todayKey() : '';
    const todayMin = todayKey ? Math.round((daily[todayKey] || 0) / 60) : 0;
    /* 总字数：书籍 size（字节）近似估算汉字数（UTF-8 中文 3 字节/字）
       优化：结果按「书籍数 + 各书 size 之和」做缓存键，命中则跳过 reduce。
       书籍增删改后键必然变化，缓存自动失效，无需手动清理。 */
    const totalWords = (function () {
      try {
        let sig = books.length + '|';
        for (let i = 0; i < books.length; i++) sig += (books[i] && books[i].size ? books[i].size : 0) + ',';
        if (BF._homeWordsCache && BF._homeWordsCache.sig === sig) return BF._homeWordsCache.val;
        const val = books.reduce(function (s, b) { return s + Math.round((b.size || 0) / 3); }, 0);
        BF._homeWordsCache = { sig: sig, val: val };
        return val;
      } catch (e) { return books.reduce(function (s, b) { return s + Math.round((b.size || 0) / 3); }, 0); }
    })();
    const old = hs.textContent;
    const streakN = BF.stats.streak ? BF.stats.streak() : 0;
    hs.innerHTML = '<span><span class="num" id="hs-books">' + books.length + '</span>书籍</span>' +
      '<span><span class="num" id="hs-words">' + BF.util.fmtNum(totalWords) + '</span>总字数</span>' +
      '<span><span class="num" id="hs-today">' + todayMin + '</span>分钟今天</span>' +
      '<span><span class="num" id="hs-streak">' + streakN + '</span>天连续</span>';
    /* 数字变化 pop 动效 */
    if (old) {
      ['hs-books', 'hs-words', 'hs-today', 'hs-streak'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) { el.classList.add('pop'); setTimeout(function () { el.classList.remove('pop'); }, 300); }
      });
    }
    if (BF.taste && BF.taste.countUp) BF.taste.countUp(hs);
  }
  BF.app.updateResume();
};
BF.app.updateResume = function () {
  const s = BF.store.lsGet(BF.store.K.TTS_SESSION, null);
  const h = document.getElementById('resume-hint');
  if (h) {
    const show = s && Date.now() - s.timestamp < 30 * 60 * 1000;
    h.classList.toggle('show', !!show);
  }
  const btn = document.getElementById('btn-continue');
  if (btn) {
    const last = BF.store.lsGet(BF.store.K.LAST_BOOK, null);
    /* 只认 LAST_BOOK 会把按钮点亮在一本已被删除的书上：点了没反应（或报「找不到书」）。
       可用与否按「那本书还在不在」判，与 humanizeContinue 的文案同一个事实源。 */
    const meta = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    btn.disabled = !(last && meta.some(function (x) { return x && x.id === last; }));
  }
};

