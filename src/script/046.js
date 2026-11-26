/* ================= L3. 文件名清洗 ================= */
BF.library.cleanName = function (rawName) {
  /* 与文件选择器的 accept 对齐：放行 .txt / .text / .json，书名就不该把扩展名带进书架 */
  const name = String(rawName).replace(/\.(?:txt|text|json)$/i, '').trim() || '未命名书籍';
  return name.replace(/(?:[（(【\[][^）)】\]]*(?:[卷册部集篇回]|上|中|下|全|完结)[）)】\]][\s_\-]*(?:第[一二三四五六七八九十百千\d]+[卷册部集篇回]|第一[一二三四五六七八九十百千]?[卷册部集篇回])$)/, '') || name;
};

/* 去重检测：书名相同且体积相近（≤5% 偏差）即视为同一本书 */
BF.library.isDuplicate = function (name, size, opt) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  /* opt.src 限定来源通道。文件名同名 + 体积近似就判重，
     会导致「同一本书」从剪贴板与 URL 两条通道互相顶掉。
     opt.legacyChars：旧版剪贴板书体积存的是字符数，按字符数再比一次。 */
  const _sizes = [];
  if (size != null) _sizes.push(size);
  if (opt && typeof opt.legacyChars === 'number') _sizes.push(opt.legacyChars);
  return books.find(function (b) {
    if (opt && opt.src && String(b.src || '') !== opt.src) return false;
    if (!b || b.title !== name) return false;
    if (!_sizes.length) return true;
    return _sizes.some(function (sz) { return Math.abs((b.size || 0) - sz) < Math.max(sz * 0.05, 1); });
  });
};

