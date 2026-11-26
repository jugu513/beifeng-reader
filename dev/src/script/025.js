/* ================= 12. BF.dom 工具 ================= */
BF.dom = (function () {
  /* 白名单里没有表单与交互控件：这五个入口（AI 回答、AI 会话、选中解析、
     便签预览、章节摘要）的 HTML 全部来自模型输出或外部文本，一个 <button>
     /<input> 就足以在正文里造出一个「看起来是本程序」的可点控件或假输入框
     （仿冒登录框骗密钥）。markdown 本身也不需要它们——真需要按钮的地方走界面代码。 */
  const SAFE_TAGS = new Set(['P','DIV','SPAN','BR','B','STRONG','I','EM','U','S','CODE','PRE','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','HR','A','IMG','TABLE','THEAD','TBODY','TR','TH','TD','SECTION','HEADER','FOOTER','SMALL','SUP','SUB','MARK','DETAILS','SUMMARY','SVG','LINE','CIRCLE','TEXT','PATH','G','POLYLINE','POLYGON','TITLE','RECT','ELLIPSE']);
  const SAFE_ATTR = new Set(['href','src','alt','title','class','id','target','rel','width','height','viewBox','d','cx','cy','r','x','y','x1','y1','x2','y2','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','text-anchor','font-size','transform','points','rx','ry','font-weight','opacity']);
  let _sanCache = new Map();
  let _sanBytes = 0;   /* 缓存总字节：与条数双上限，防长会话驻留过多 HTML */
  const SAN_CACHE_MAX = 200, SAN_CACHE_MAX_BYTES = 256 * 1024;
  /* UTF-8 字节数：唯一实现在 BF.util.byteLen（与书籍体积同口径）。
     TextEncoder 不可用时按三字节估，宁可偏大也不退回 String.length。 */
  function _byteLen(s) { try { return BF.util.byteLen(s); } catch (e) { return s.length * 3; } }
  /* URL 属性不能只做字面 /javascript:/i 匹配——
     `java\tscript:`（浏览器解析 URL 时剥离 \t\n\r，正则匹配不到）即可
     绕过，data:text/html 也完全管不住。
     做法：先剔除控制字符与空白（与浏览器导航时的剥离方式一致），
     再取 scheme 判白名单：
     http/https/mailto 放行；data: 仅放行 image/* 且仅 src（img 上下文
     不执行脚本，data:text/html 则会）；vbscript/blob 等一律拒。 */
  const _URL_SAFE_SCHEME = { http: 1, https: 1, mailto: 1 };
  function _urlOk(attrName, value) {
    const v = String(value == null ? '' : value).replace(/[\u0000-\u0020]+/g, '');
    if (!v) return true;                                    /* 空值无害 */
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(v);
    if (!m) return true;                                    /* 相对地址 / 锚点 / 协议相对 */
    const sch = m[1].toLowerCase();
    if (sch === 'data') {
      return String(attrName).toLowerCase() === 'src' &&
        /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i.test(v);
    }
    return !!_URL_SAFE_SCHEME[sch];
  }
  /* 注入内容里的 id 不许顶掉本页已有的 id：getElementById 与事件委托都按 id
     取节点，撞名之后那一次点击落在正文里伪造的控件上，而不是本程序那个。 */
  function _idClash(v) {
    const s = String(v == null ? '' : v);
    if (!s) return false;
    try { return !!document.getElementById(s); } catch (e) { return true; }
  }
  /* 仅放行纯样式值（单条 "prop: val"），剔除 url()/expression()/@import/分号/花括号等
     潜在脚本载体，防存储型 XSS 经 style 属性注入。 */
  function _cleanStyle(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/url\s*\(|expression\s*\(|@import|javascript:|<script|behavior\s*:/i.test(s)) return null;
    if (/[;{}]/.test(s)) return null;
    if (!/^[-a-z]+\s*:\s*[^;]+$/i.test(s)) return null;
    return s;
  }
  /* 1×1 透明占位：远程图片默认不自动取时用它顶上（见 sanitize 内 data-lazy-src） */
  const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function sanitize(html) {
    const s = String(html);
    if (s.length <= 8192 && _sanCache.has(s)) return _sanCache.get(s);
    let out;
    try {
      const doc = new DOMParser().parseFromString(s, 'text/html');
      const nodes = [];
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const el of nodes) {
        if (!SAFE_TAGS.has(String(el.tagName).toUpperCase())) { el.replaceWith(...el.childNodes); continue; }
        for (const a of [...el.attributes]) {
          const ln = a.name.toLowerCase();
          if (ln === 'style') {
            const cv = _cleanStyle(a.value);
            if (cv == null) el.removeAttribute(a.name); else el.setAttribute(a.name, cv);
            continue;
          }
          const isUrl = ln === 'href' || ln === 'src';
          /* 属性名按两种写法都查一次：解析器会把 HTML 属性名统一成小写，但 SVG
             的 viewBox / preserveAspectRatio 这类是调过大小写的原样名字，白名单里
             记的就是那份写法；只按小写查会把图标 SVG 的 viewBox 剥掉。 */
          if ((!SAFE_ATTR.has(a.name) && !SAFE_ATTR.has(ln)) || ln.startsWith('on') ||
              (isUrl && !_urlOk(ln, a.value)) || (ln === 'id' && _idClash(a.value))) {
            el.removeAttribute(a.name);
          }
        }
        /* 远程图片默认不自动取：正文/便签/AI 回答里一张 <img src="https://…?q=…">
           在渲染那一刻就把「你在读什么」发给对面，事后撤回不了。默认把地址挪进
           data-lazy-src 留一个可点击占位；设置 → 阅读 → 外部图片 打开后照旧直发。 */
        if (String(el.tagName).toUpperCase() === 'IMG' && BF.settings.get('remoteImg') !== true) {
          const sv = String(el.getAttribute('src') || '');
          if (/^(?:https?:)?\/\//i.test(sv)) {
            el.setAttribute('data-lazy-src', sv);
            el.setAttribute('src', BLANK_IMG);
            el.setAttribute('class', (el.getAttribute('class') ? el.getAttribute('class') + ' ' : '') + 'bf-img-pending');
            el.setAttribute('title', '点击加载这张图片（来自外部地址）');
          }
        }
        /* target=_blank 一律补 rel：没有 noopener，被打开的页面能顺着 window.opener 改本页 */
        if (String(el.tagName).toUpperCase() === 'A' && /_blank/i.test(String(el.getAttribute('target') || ''))) {
          const rv = String(el.getAttribute('rel') || '');
          if (!/noopener/i.test(rv)) el.setAttribute('rel', (rv ? rv + ' ' : '') + 'noopener noreferrer');
        }
      }
      out = doc.body.innerHTML;
    } catch (e) {
      BF.err.report('sanitize', e);
      out = s.replace(/[<>]/g, '');
    }
    if (s.length <= 8192) {
      /* 双上限淘汰：超条数或超总字节都摘最旧 */
      while (_sanCache.size >= SAN_CACHE_MAX || (_sanBytes + _byteLen(s) > SAN_CACHE_MAX_BYTES && _sanCache.size > 0)) {
        const first = _sanCache.keys().next().value;
        if (first === undefined) break;
        _sanBytes -= _byteLen(first);
        _sanCache.delete(first);
      }
      _sanCache.set(s, out); _sanBytes += _byteLen(s);
    }
    return out;
  }
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    /* 实体表提为常量——渲染期成千次调用不再每次新建对象 */
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  /* 高频内联图标去重：关闭按钮 SVG 单处存放、多处引用，不在各面板字符串里重复 */
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  /* 搜索命中片段的清洗：多章正文用 \n@@CH@@\n 拼成合并串再检索，分隔符会被带进上下文。
     书内搜索与跨书搜索共用这一份 —— 两处各写一遍正则，改一处就漏一处。 */
  function cleanSearchCtx(s) {
    return String(s == null ? '' : s).replace(/@@CH@@/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* 把「可能是外来数据」的数当数用：非负整数才返回字符串，否则返回 null。
     备份、跨标签同步、未来导入的记录都没有类型保证，直接拼进 data-* 就是属性逃逸
     ——`" onmouseover="…"` 这类值会把后面的属性变成可执行代码。 */
  function intAttr(v) { const n = Number(v); return Number.isInteger(n) && n >= 0 ? String(n) : null; }
  return { sanitize, esc, escAttr: esc, cleanSearchCtx, intAttr, invalidateCache: function () { _sanCache = new Map(); }, ICON_CLOSE };

})();

/* ============================================================
   北风 · 导航 / 主题 / 首页 / 书架 / 启动辅助
   ============================================================ */

