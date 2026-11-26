/* ================= 14. 外观应用（BF.theme 为兼容面） =================
   theme ∪ appearance 合并后这一层只做一件事：把 appearance 档位落到 body
   （作用域 class + 色板内联令牌 + 强调色档），并把渲染轴广播成 THEME 事件。
   档位与色板一张表：BF.SKINS（明暗四档 light/dark/black/system + 五套色板），
   色值在 BF.SKIN_TOKENS —— 不存在第二份「明暗四档」清单。 */
/* 强调色档位表提为模块常量：避免每次 theme.apply（换肤/SETTINGS 广播/场景）
   都重建整个四色对象；值与 AA 解档结论不变。 */
const ACCENTS = {
  /* fillSu / inkSu：素/霁（冷瓷底 #f5f7f9 / 面板 #ffffff / 输入 #edf1f5）下逐档重解 ——
     底色档压到白字 >=4.6，文字档压到冷瓷两处底面都 >=4.6。 */
  red:   { fill: '#d94f38', ink: '#e86852', fillL: '#c43d2a', inkL: '#c43d2a', fillSu: '#c0432f', inkSu: '#be422e' },
  amber: { fill: '#c98f4e', ink: '#e0a96a', fillL: '#a06a30', inkL: '#945f2c', fillSu: '#9e692f', inkSu: '#92612c' },
  green: { fill: '#2dbe75', ink: '#62da9e', fillL: '#1f8452', inkL: '#1c784a', fillSu: '#1f7a52', inkSu: '#1f7a52' },
  blue:  { fill: '#2e82c2', ink: '#62a6da', fillL: '#2974ae', inkL: '#266ca1', fillSu: '#2f5fa8', inkSu: '#2f5fa8' },
};
