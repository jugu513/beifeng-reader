/* ================= G1. 书架分组（Collection） =================
   语义照业界通行形态（Apple Books 精选集 / Kindle Collections / Calibre 虚拟书架）：
   组＝名字 + 成员；**一本书可以同时属于多个组**；组不嵌套、不做图标体系；
   删组只删归属，绝不动正文与元数据。
   两张表分开放：组目录 `shelf_groups`，归属 `shelf_group_items`（bookId → [groupId]）。
   不塞进 BOOKS_META —— 那里有几十处读取，改组不该重写整本元数据。 */
BF.shelf = (function () {
  const GK = BF.store.K.SHELF_GROUPS, IK = BF.store.K.SHELF_ITEMS;
  function gid() { return 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  function groups() {
    /* 分组表在渲染热路径上每帧要读四次（筛选条 / 分组 chips / 卡面角标 / 归属计数），
       每次 lsGet 各 parse 一遍全表 —— 和 items() 同一宗罪，同一味药：按写入代次记忆。
       返回的数组按只读用；下面的 filter 已经产生新数组，sort 不会动到缓存本体。 */
    const a = BF.store.lsGetMemo(GK, []);
    if (!Array.isArray(a)) return [];
    return a.filter(function (x) { return x && x.id && x.name; })
      .sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
  }
  function items() {
    /* 整张归属表：书卡渲染时每本调一次 groupsOf ⇒ 这里每本各 parse 一遍全表。
       按原始串记忆，返回对象按只读用。 */
    const m = BF.store.lsGetMemo(IK, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }
  function groupsOf(bookId) {
    const v = items()[String(bookId)];
    return Array.isArray(v) ? v.filter(function (g) { return !!g; }) : [];
  }
  function bookIdsIn(groupId) {
    const m = items(), out = [];
    Object.keys(m).forEach(function (b) { if (Array.isArray(m[b]) && m[b].indexOf(groupId) >= 0) out.push(b); });
    return out;
  }
  /* 归属计数（筛选条与组管理列表都读这个，别再抄第二份统计） */
  function countOf(groupId) { return bookIdsIn(groupId).length; }

  function writeItems(mut) {
    return BF.store.mutate(IK, function (cur) {
      const m = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
      mut(m);
      return m;
    });
  }
  function writeGroups(mut) {
    return BF.store.mutate(GK, function (cur) {
      const a = Array.isArray(cur) ? cur.slice() : [];
      mut(a);
      return a;
    });
  }
  function create(name) {
    const t = String(name || '').trim();
    if (!t) return Promise.reject(new Error('分组名不能为空'));
    if (groups().some(function (g) { return g.name === t; })) return Promise.reject(new Error('已有同名分组「' + t + '」'));
    const g = { id: gid(), name: t, order: groups().length, createdAt: Date.now() };
    return writeGroups(function (a) { a.push(g); }).then(function () { return g; });
  }
  function rename(id, name) {
    const t = String(name || '').trim();
    if (!t) return Promise.reject(new Error('分组名不能为空'));
    return writeGroups(function (a) {
      const g = a.find(function (x) { return x && x.id === id; });
      if (g) g.name = t;
    }).then(function () { BF.app.renderBookshelf(); });
  }
  /* 删组：只摘归属，不动任何一本书。撤销由调用方按两张表的快照给出（act.run 的 undo 通道） */
  function remove(id) {
    const g = groups().find(function (x) { return x.id === id; });
    if (!g) return Promise.resolve(false);
    return writeGroups(function (a) {
      for (let i = a.length - 1; i >= 0; i--) if (a[i] && a[i].id === id) a.splice(i, 1);
    }).then(function (okG) {
      /* mutate 的返回值就是「这次到底落盘没有」：配额拦截、存储异常、盲读闸门
         都会让它假。接不住就会报「已删除」而组还在盘上，刷新一次又回来。 */
      if (!okG) { BF.noti.error('删除分组未生效：本机存储写不进去，分组「' + g.name + '」原样保留'); return false; }
      return writeItems(function (m) {
        Object.keys(m).forEach(function (b) {
          if (!Array.isArray(m[b])) return;
          m[b] = m[b].filter(function (x) { return x !== id; });
          if (!m[b].length) delete m[b];
        });
      }).then(function (okI) {
        if (okI) {
          BF.app.renderBookshelf();
          BF.noti.success('已删除分组「' + g.name + '」，组里的书都还在');
          return true;
        }
        /* 归属这一步没落盘，而分组那一步已经落了：留在盘上就是「组没了、
           书的归属里还挂着它的 id」的半截状态。先把组放回原处，放回失败才让用户撤销。 */
        return writeGroups(function (a) {
          if (!a.some(function (x) { return x && x.id === id; })) a.push(g);
        }).then(function (back) {
          BF.app.renderBookshelf();
          BF.noti.error(back ? '删除分组未完成：书的归属写不进去，分组已放回，这本书没有被改动'
                             : '删除分组只做了一半：分组已删、归属没清掉，也放不回去——按 Ctrl+Z 撤销');
          return false;
        });
      });
    });
  }
  function setBook(bookId, ids) {
    const want = (ids || []).filter(Boolean);
    return writeItems(function (m) {
      if (want.length) m[String(bookId)] = want; else delete m[String(bookId)];
    });
  }
  /* 批量落差量：勾上＝加入、取消勾＝移出，一次写回。
     不做「整表覆盖」——多本书各有归属，覆盖会互相抹掉。 */
  function applyDiff(bookIds, adds, removes) {
    return writeItems(function (m) {
      (bookIds || []).forEach(function (b) {
        const k = String(b);
        let cur = Array.isArray(m[k]) ? m[k].slice() : [];
        (adds || []).forEach(function (g) { if (cur.indexOf(g) < 0) cur.push(g); });
        (removes || []).forEach(function (g) { cur = cur.filter(function (x) { return x !== g; }); });
        if (cur.length) m[k] = cur; else delete m[k];
      });
    });
  }
  /* 删书级联：书没了，它的归属条目就成了孤儿引用。
     只挂在 _doDelete（彻底销毁）上，不挂「移进回收站」——
     回收站的书要能无损恢复，分组跟着走才对。 */
  function purgeBook(bookId) {
    return writeItems(function (m) { delete m[String(bookId)]; });
  }
  /* 启动自检（只告警不删，与标注侧同一口径）：引用了已不存在的组/书 */
  function audit() {
    const valid = new Set(groups().map(function (g) { return g.id; }));
    const m = items();
    let ghostGroup = 0, ghostBook = 0;
    /* 「有这本书」要算上回收站：移入回收站的书只是离开书架，归属照旧保留，
       还原后仍在原组里。不把回收站并进来，每次自检都会把正常暂存的书报成
       「无此书的归属」，用户被告知有一处无效归属而实际正常。
       与 BF.heal.repairOrphans 同一口径。 */
    const known = new Set((BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).map(function (b) { return b && b.id; }));
    (BF.store.lsGetArray(BF.store.K.TRASH, []) || []).forEach(function (t) {
      /* 回收站一条是 { meta: {...}, deletedAt } —— 书 id 在 meta.id 里，不在顶层 */
      const _id = t && (t.id || (t.meta && t.meta.id) || (t.book && t.book.id));
      if (_id) known.add(String(_id));
    });
    Object.keys(m).forEach(function (b) {
      if (!known.has(b)) ghostBook++;
      (m[b] || []).forEach(function (g) { if (!valid.has(g)) ghostGroup++; });
    });
    if (ghostGroup || ghostBook) BF.log.warn('分组表有残留引用：失效组 ' + ghostGroup + ' 处、无此书的归属 ' + ghostBook + ' 处（未自动删除）');
    return { ghostGroup: ghostGroup, ghostBook: ghostBook };
  }

  /* ---------- 选择面板（多选 + 就地新建），书卡菜单与批量条共用一份 ---------- */
  function openPicker(bookIds, onDone) {
    const ids = (bookIds || []).filter(Boolean);
    if (!ids.length) return;
    const gs = groups();
    /* 打开时显示为已勾的分组 = 这些书的公共分组（交集）。
       写成「只有单选才算」会让多选时 current 恒空 ⇒ removes 恒空 ⇒
       面板上那句「取消勾选则移出」永远不会生效，移出分组这一半能力被上游掐死。
       只属于部分书的组显示未勾：勾上即加入全部选中书（applyDiff 的 adds 语义）。 */
    let _inter = groupsOf(ids[0]);
    for (let _i = 1; _i < ids.length; _i++) { const _g = groupsOf(ids[_i]); _inter = _inter.filter(function (x) { return _g.indexOf(x) >= 0; }); }
    const current = new Set(_inter);
    const body =
      '<div class="grp-pick">' +
      '<div class="grp-pick__tip">' + (ids.length > 1 ? '已选中 ' + ids.length + ' 本，勾上的分组会加到全部选中书；取消勾选则移出。' : '勾选＝加入 / 移出该组（一本书可同时在多个分组）。') + '</div>' +
      '<div class="grp-pick__list">' + (gs.length ? gs.map(function (g) {
        const n = countOf(g.id);
        return '<label class="grp-row"><input type="checkbox" data-grp="' + BF.dom.escAttr(g.id) + '"' + (current.has(g.id) ? ' checked' : '') + '>' +
          '<span class="grp-row__n">' + BF.dom.esc(g.name) + '</span><span class="grp-row__c">' + n + ' 本</span></label>';
      }).join('') : '<div class="grp-pick__none">还没有分组，下面新建一个</div>') + '</div>' +
      '<div class="grp-new"><input type="text" class="input" data-grp-new placeholder="新分组名，例：氛围相近短篇"><button class="btn btn-sm" data-grp-add>新建并放入</button></div>' +
      '<div class="dlg-foot"><button class="btn btn-sm" data-modal-cancel>取消</button><button class="btn btn-sm btn-primary" data-grp-ok>应用</button></div>' +
      '</div>';
    const dismiss = BF.modal.custom('分组：' + (ids.length > 1 ? ids.length + ' 本书' : '这本书'), body, function (box) {
      const apply = function (extraName) {
        const now = new Set(Array.prototype.slice.call(box.querySelectorAll('[data-grp]:checked')).map(function (el) { return el.dataset.grp; }));
        const adds = [...now].filter(function (g) { return !current.has(g); });
        const removes = [...current].filter(function (g) { return !now.has(g); });
        const finish = function () { BF.app.renderBookshelf(); if (onDone) onDone(); };
        if (extraName) {
          BF.shelf.create(extraName).then(function (g) {
            return BF.shelf.applyDiff(ids, adds.concat([g.id]), removes);
          }).then(finish).catch(function (e) { BF.noti.warn(String(e && e.message || e)); });
        } else {
          BF.shelf.applyDiff(ids, adds, removes).then(finish);
        }
      };
      box.querySelector('[data-modal-cancel]').addEventListener('click', function () { dismiss(); BF.modal.hide(); });
      box.querySelector('[data-grp-ok]').addEventListener('click', function () { apply(box.querySelector('[data-grp-new]').value.trim()); });
      box.querySelector('[data-grp-add]').addEventListener('click', function () {
        const nm = box.querySelector('[data-grp-new]').value.trim();
        if (!nm) { BF.noti.warn('先写个分组名'); return; }
        apply(nm);
        box.querySelector('[data-grp-new]').value = '';
      });
    });
  }

  /* ---------- 分组管理（改名 / 删除）---------- */
  function openManage() {
    const gs = groups();
    const body = '<div class="grp-pick">' +
      (gs.length ? '<div class="grp-pick__list">' + gs.map(function (g) {
        return '<div class="grp-row is-manage"><span class="grp-row__n">' + BF.dom.esc(g.name) + '</span>' +
          '<span class="grp-row__c">' + countOf(g.id) + ' 本</span>' +
          '<button class="btn btn-xs" data-grp-rename="' + BF.dom.escAttr(g.id) + '">改名</button>' +
          '<button class="btn btn-xs danger" data-grp-del="' + BF.dom.escAttr(g.id) + '">删除</button></div>';
      }).join('') + '</div>' : '<div class="grp-pick__none">还没有分组。回到书架筛选条点「新建分组」。</div>') +
      '<div class="dlg-foot"><button class="btn btn-sm" data-modal-cancel>关闭</button></div></div>';
    const dismiss = BF.modal.custom('分组管理', body, function (box) {
      box.querySelector('[data-modal-cancel]').addEventListener('click', function () { dismiss(); BF.modal.hide(); });
      box.querySelectorAll('[data-grp-rename]').forEach(function (b) {
        b.addEventListener('click', function () {
          const id = b.dataset.grpRename;
          const g = groups().find(function (x) { return x.id === id; });
          BF.modal.prompt('重命名分组', '分组名：', { value: g ? g.name : '' }).then(function (v) {
            if (v == null) return;
            BF.shelf.rename(id, v).catch(function (e) { BF.noti.warn(String(e && e.message || e)); });
          });
        });
      });
      box.querySelectorAll('[data-grp-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          const id = b.dataset.grpDel;
          const g = groups().find(function (x) { return x.id === id; });
          const n = countOf(id);
          dismiss(); BF.modal.hide();
          BF.ask.confirm({
            title: '确认执行：删除分组',
            body: '删除分组「' + (g ? g.name : '') + '」？组里的 ' + n + ' 本书不会被删，只是不再归到这个组。',
            danger: 2, op: 'shelf.groupDelete', extent: '分组 1 个（' + n + ' 条归属）',
          }).then(function (ok) {
            if (!ok) return;
            /* 撤销按「这条记录的逆操作」做，不整表回滚：整表快照会把删除之后
               新建的分组一起抹掉——用户删一个组、按一下撤销，丢的可能是另外几个组。
               这里只放回被删的那个组，和它删之前带着的那些书的归属。 */
            const back = { grp: g, books: bookIdsIn(id) };
            BF.act.run('删除分组', function () { return remove(id); }, {
              /* 分组是书架级数据，不属于当前书 ⇒ 不带书归属 */
              bookId: null,
              undo: function () {
                if (!back.grp) return false;
                return writeGroups(function (a) {
                  if (!a.some(function (x) { return x && x.id === back.grp.id; })) a.push(back.grp);
                }).then(function (okG) {
                  return writeItems(function (m) {
                    back.books.forEach(function (b) {
                      const arr = Array.isArray(m[b]) ? m[b].slice() : [];
                      if (arr.indexOf(back.grp.id) < 0) arr.push(back.grp.id);
                      m[b] = arr;
                    });
                  }).then(function (okI) {
                    BF.app.renderBookshelf();
                    if (!okG || !okI) BF.noti.error('撤销未生效：分组放回写不进去，请重做删除');
                  });
                });
              },
            });
          });
        });
      });
    });
  }

  return { groups, items, groupsOf, bookIdsIn, countOf, create, rename, remove, setBook, setBookGroups: setBook, applyDiff, purgeBook, audit, openPicker, openManage };
})();

/* 悬空筛选对账：删组、删标签或最后一本带该标签的书被删之后，
   __groupFilter / __tagFilter 仍指向已不存在的目标 ⇒ 书架筛成 0 本，而顶栏下拉的
   选项里已经没有它，于是显示「全部分组」——名实不符，用户既看不到原因也找不到清除入口，
   之后导入的书全部「消失」。筛选只有一处读取，对账就放在那处读取前面。 */
BF.library.reconcileFilters = function () {
  const dropped = [];
  if (BF.library.__tagFilter) {
    let tags = null;
    try { tags = BF.library.allTags(); } catch (e) { BF.err.report('filter.tagProbe', e); }
    if (Array.isArray(tags) && tags.indexOf(BF.library.__tagFilter) < 0) {
      dropped.push('标签「' + BF.library.__tagFilter + '」');
      BF.library.__tagFilter = '';
    }
  }
  if (BF.library.__groupFilter) {
    let gs = null;
    try { gs = BF.shelf.groups(); } catch (e) { BF.err.report('filter.groupProbe', e); }
    if (Array.isArray(gs) && !gs.some(function (g) { return g && g.id === BF.library.__groupFilter; })) {
      dropped.push('分组「' + (BF.library.__groupFilterName || BF.library.__groupFilter) + '」');
      BF.library.__groupFilter = '';
      BF.library.__groupFilterName = '';
    }
  }
  if (dropped.length) {
    BF.noti.info('筛选已自动清除：' + dropped.join('、') + ' 已不存在。书架恢复显示全部书籍。',
      { action: { label: '刷新书架', run: function () { try { BF.app.renderBookshelf(); } catch (e) {} } } });
  }
  return dropped.length;
};
/* 书架「当前可见集」的唯一口径：渲染与批量「全选」共用同一个函数。
   全选若直接遍历 BOOKS_META 全表 ⇒ 筛到只剩 1 本时点全选得到 3 本，
   计数与亮圈不符，再沿用「全选 → 批量删除」就会处理掉当前看不见的书。 */
BF.library.shelfVisible = function () {
  BF.library.reconcileFilters();
  let books = BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, []));
  /* mergeReadingState 可能残留 null/非对象条目（corrupt 自愈边界），
     排序与取属性前先净化，避免空数组 / undefined 崩溃 */
  books = (books || []).filter(function (b) { return b && typeof b === 'object' && b.id; });
  if (BF.library.__tagFilter) books = books.filter(b => b && b.tags && b.tags.includes(BF.library.__tagFilter));
  /* 分组筛选读的是归属表（bookId → [groupId]），不读 BOOKS_META —— 视图层归属不该混进元数据 */
  if (BF.library.__groupFilter) {
    const _gm = BF.shelf.items();
    books = books.filter(b => b && Array.isArray(_gm[String(b.id)]) && _gm[String(b.id)].indexOf(BF.library.__groupFilter) >= 0);
  }
  const searchEl = document.getElementById('book-search');
  const sq = searchEl ? searchEl.value.trim().toLowerCase() : '';
  if (sq) books = books.filter(b => b && b.title && b.title.toLowerCase().includes(sq));
  return books;
};

